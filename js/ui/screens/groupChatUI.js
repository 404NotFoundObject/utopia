// js/ui/screens/groupChatUI.js
import { getAppState } from '../../core/state.js';
import { getGroup, getGroupMembers, getGroupMessages, sendUserGroupMessage } from '../../modules/groupChat.js';
import { renderMarkdown, renderMarkdownStream, initCodeCopyHandler } from '../components/markdown.js';
import { formatTime, escapeHtml } from '../../core/utils.js';
import { showToast } from '../components/toast.js';
import { openModal, closeModal } from '../components/modal.js';
import {
  undoLastUserMessage,
  regenerateGroupReply,
  muteGroupMember,
  removeGroupMember,
  getUserRoleInGroup,
} from '../../modules/groupChatOperations.js';
import { getCurrentCharacter } from '../../modules/character.js';
import { isSpeaking } from '../../services/ttsService.js';
import { createMessageSpeechHandler } from '../../utils/messageSpeech.js';
import { getCleanContentFromElement, extractDialogueText, hasSpeakableContent } from '../../utils/messageUtils.js';
import { getRenderer } from '../../plugins/uiRuntime.js';
import * as contextMenuRegistry from '../components/contextMenuRegistry.js';
import globalEventBus from '../../core/eventBus.js';

let currentGroupId = null;
let container = null;

let _headerMemberUnsubscribers = [];

const groupSpeechHandler = createMessageSpeechHandler({
  messageSelector: '.group-message',
  bubbleSelector: '.group-message-bubble',
  stateKey: '_speakingGroupMsgId',
  getContainer: () => container,
  resolveCharacter: (msg, character) => {
    const chars = getAppState().get('characters') || [];
    let target = character;
    if (!target || !target.id) {
      target = chars.find(c => c.id === msg.senderId);
    } else {
      const latest = chars.find(c => c.id === target.id);
      if (latest) target = latest;
    }
    return target;
  },
  logPrefix: '[TTS] 群聊',
});

const _streamingMsgIds = new Set();
const _streamingTimeouts = new Map();
const STREAMING_TIMEOUT_MS = 60000;

export function isGroupStreaming() {
  return _streamingMsgIds.size > 0;
}

export function markGroupStreaming(msgId) {
  if (!msgId) return;
  _streamingMsgIds.add(msgId);

  const existing = _streamingTimeouts.get(msgId);
  if (existing) clearTimeout(existing);

  const timer = setTimeout(() => {
    if (_streamingMsgIds.has(msgId)) {
      console.warn(`[GroupChatUI] 流式标记超时自动清理: ${msgId}`);
      _streamingMsgIds.delete(msgId);
    }
    _streamingTimeouts.delete(msgId);
  }, STREAMING_TIMEOUT_MS);

  _streamingTimeouts.set(msgId, timer);
}

export function unmarkGroupStreaming(msgId) {
  if (!msgId) return;
  _streamingMsgIds.delete(msgId);
  const timer = _streamingTimeouts.get(msgId);
  if (timer) {
    clearTimeout(timer);
    _streamingTimeouts.delete(msgId);
  }
}

export function clearAllStreamingMarks() {
  for (const timer of _streamingTimeouts.values()) {
    try { clearTimeout(timer); } catch (_) {}
  }
  _streamingTimeouts.clear();
  _streamingMsgIds.clear();
  console.debug('[GroupChatUI] 已清空所有流式标记');
}

export function setGroupChatContainer(el) {
  container = el;
  if (el) {
    initCodeCopyHandler(el);
  }
}

function setGroupChatBackground(bgUrl) {
  var containerEl = document.getElementById('chatMessages');
  if (!containerEl) return;
  if (bgUrl) {
    containerEl.style.backgroundImage = 'url(' + bgUrl + ')';
    containerEl.style.backgroundSize = 'cover';
    containerEl.style.backgroundPosition = 'center';
    containerEl.style.backgroundRepeat = 'no-repeat';
    containerEl.style.backgroundColor = 'var(--color-bg-secondary)';
  } else {
    containerEl.style.backgroundImage = 'none';
    containerEl.style.backgroundColor = 'var(--color-bg-secondary)';
  }
}

function speakGroupMessage(msg, character) {
  return groupSpeechHandler.speak(msg, character);
}

function updateGroupSpeakButtonState(msgId, isPlaying) {
  return groupSpeechHandler.updateButtonState(msgId, isPlaying);
}

export async function openGroupChat(groupId) {
  currentGroupId = groupId;
  var group = await getGroup(groupId);
  if (!group) {
    showToast('群组不存在', 'error');
    return;
  }

  var state = getAppState();
  state.set('currentMode', 'group');
  state.set('currentGroupId', groupId);

  var members = await getGroupMembers(groupId);
  updateHeader(group, members.length);

  _bindHeaderMemberListeners(groupId);

  setGroupChatBackground(group.chatBg);

  document.getElementById('welcomePage').style.display = 'none';
  document.getElementById('chatContainer').style.display = 'flex';
  document.getElementById('chatContainer').classList.add('active');

  await renderMessages(groupId, { force: true });

  if (!window._mentionInitialized) {
    initMentionPicker();
    window._mentionInitialized = true;
  }
}


/**
 * 解绑上一次绑定的成员变更监听器。
 */
function _unbindHeaderMemberListeners() {
  for (var i = 0; i < _headerMemberUnsubscribers.length; i++) {
    try { _headerMemberUnsubscribers[i](); } catch (_) {}
  }
  _headerMemberUnsubscribers = [];
}

/**
 * 绑定群成员变更监听器。
 */
function _bindHeaderMemberListeners(groupId) {
  _unbindHeaderMemberListeners();

  var onMemberAdded = function (payload) {
    if (!payload || payload.groupId !== groupId) return;
    var s = getAppState();
    if (s.get('currentMode') !== 'group') return;
    if (s.get('currentGroupId') !== groupId) return;
    _refreshHeaderMemberCount(groupId);
  };

  var onMemberRemoved = function (payload) {
    if (!payload || payload.groupId !== groupId) return;
    var s = getAppState();
    if (s.get('currentMode') !== 'group') return;
    if (s.get('currentGroupId') !== groupId) return;
    _refreshHeaderMemberCount(groupId);
  };

  var unsubAdded = globalEventBus.on('group:member-added', onMemberAdded);
  var unsubRemoved = globalEventBus.on('group:member-removed', onMemberRemoved);

  if (typeof unsubAdded === 'function') _headerMemberUnsubscribers.push(unsubAdded);
  if (typeof unsubRemoved === 'function') _headerMemberUnsubscribers.push(unsubRemoved);
}

/**
 * 重新查询成员列表并更新头部的人数文本。
 */
async function _refreshHeaderMemberCount(groupId) {
  if (groupId !== currentGroupId) return;
  try {
    var members = await getGroupMembers(groupId);
    var relationEl = document.getElementById('charRelation');
    if (relationEl) relationEl.textContent = members.length + ' 人';
  } catch (e) {
    console.warn('[GroupChatUI] 刷新群成员数失败:', e);
  }
}

// ============================================================

export async function renderMessages(groupId, opts = {}) {
  const { force = false } = opts;

  if (!container) container = document.getElementById('chatMessages');
  if (!container) return;

  const appState = getAppState();
  const isCurrentGroup = appState.get('currentMode') === 'group'
                     && appState.get('currentGroupId') === groupId;
  if (!isCurrentGroup) {
    console.debug(
      `[GroupChatUI] renderMessages 跳过: mode=${appState.get('currentMode')}, ` +
      `current=${appState.get('currentGroupId')}, target=${groupId}`
    );
    return;
  }

  if (force) {
    if (_streamingMsgIds.size > 0) {
      console.log('[GroupChatUI] 强制渲染，清空流式跟踪集合');
      clearAllStreamingMarks();
    }
  } else if (_streamingMsgIds.size > 0) {
    console.log(`[GroupChatUI] 检测到 ${_streamingMsgIds.size} 条流式消息进行中，跳过全量渲染`);
    return;
  }

  var messages = await getGroupMessages(groupId, 50);
  var members = await getGroupMembers(groupId);

  const appStateAfterAwait = getAppState();
  if (appStateAfterAwait.get('currentMode') !== 'group'
      || appStateAfterAwait.get('currentGroupId') !== groupId) {
    console.debug(
      `[GroupChatUI] renderMessages 跳过：await 期间目标群聊已切换 ` +
      `(now=${appStateAfterAwait.get('currentGroupId')}, target=${groupId})`
    );
    return;
  }

  var memberMap = {};
  var characterMap = {};

  for (var mi = 0; mi < members.length; mi++) {
    var m = members[mi];
    if (m.memberType === 'character' && m.character) {
      memberMap[m.memberId] = m.character;
      if (m.character.id) {
        characterMap[m.character.id] = m.character;
      }
    } else if (m.memberType === 'user') {
      memberMap['user'] = { name: '用户', avatar: m.user && m.user.avatar ? m.user.avatar : '' };
    }
  }

  var tempEls = container.querySelectorAll('.group-message[data-temp="true"]');
  for (var te = 0; te < tempEls.length; te++) tempEls[te].remove();

  if (messages.length === 0) {
    container.innerHTML = '<div class="empty-msg">暂无消息，说点什么吧</div>';
    container.classList.remove('group-chat-messages');
    return;
  }

  container.classList.add('group-chat-messages');

  function resolveMentionsInline(text) {
    if (!text || text.indexOf('@') === -1) return text;
    return text.replace(
      /@([^\s@，,。！？：:；;!?\n]+)/g,
      function (match, token) {
        var found = memberMap[token] || characterMap[token];
        if (found && found.name) {
          return '<span class="mentions">@' + escapeHtml(found.name) + '</span>';
        }
        for (var key in memberMap) {
          if (memberMap[key] && memberMap[key].name === token) {
            return '<span class="mentions">@' + escapeHtml(token) + '</span>';
          }
        }
        return match;
      }
    );
  }

  var html = '';
  for (var i = 0; i < messages.length; i++) {
    var msg = messages[i];
    var sender = msg.senderType === 'user'
      ? memberMap['user']
      : (memberMap[msg.senderId] || characterMap[msg.senderId]);
    var senderName = sender ? sender.name : msg.senderId;
    var avatar = sender && sender.avatar ? sender.avatar : 'data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' width=\'32\' height=\'32\' viewBox=\'0 0 32 32\'%3E%3Ccircle cx=\'16\' cy=\'16\' r=\'16\' fill=\'%23e0e0e6\'/%3E%3Ctext x=\'16\' y=\'22\' text-anchor=\'middle\' fill=\'%238a8aaa\' font-size=\'12\' font-family=\'sans-serif\'%3E?%3C/text%3E%3C/svg%3E';

    var safeMsgId = escapeHtml(msg.id);
    var safeSenderName = escapeHtml(senderName);
    var safeAvatar = escapeHtml(avatar);
    var messageRole = msg.senderType === 'user' ? 'user' : 'assistant';
    var safeMessageRole = escapeHtml(messageRole);

    var contentText = resolveMentionsInline(msg.content);

    var baseRender = function (m, text) {
      return renderMarkdown(text);
    };
    var finalRender = getRenderer('message-bubble', baseRender);
    var content;
    try {
      var rendered = finalRender(msg, contentText);
      content = typeof rendered === 'string' ? rendered : baseRender(msg, contentText);
    } catch (err) {
      console.warn('[GroupChatUI] 气泡渲染器失败，回退默认:', err);
      content = baseRender(msg, contentText);
    }

    var time = formatTime(msg.timestamp);
    var safeTime = escapeHtml(time);
    var isOwn = msg.senderType === 'user';

    var speakBtnHtml = '';
    if (msg.senderType === 'character' && msg.content && msg.content.trim().length > 0 && hasSpeakableContent(msg.content)) {
      speakBtnHtml = '<button class="speak-btn" style="flex-shrink:0;align-self:center;width:28px;height:28px;font-size:0.75rem;color:var(--color-text-muted);opacity:0.4;transition:opacity 0.2s,color 0.2s,transform 0.15s;background:var(--color-bg-secondary);border:1px solid var(--color-border);border-radius:50%;cursor:pointer;display:flex;align-items:center;justify-content:center;" title="朗读此消息"><i class="fas fa-volume-up"></i></button>';
    }

    html += '<div class="group-message ' + (isOwn ? 'own' : '') + '" ' +
      'data-id="' + safeMsgId + '" ' +
      'data-plugin-slot="message" ' +
      'data-message-id="' + safeMsgId + '" ' +
      'data-message-role="' + safeMessageRole + '" ' +
      'style="display:flex;flex-direction:column;align-items:' + (isOwn ? 'flex-end' : 'flex-start') + ';width:100%;">';

    html += '<div style="display:flex;align-items:center;gap:0.5rem;' + (isOwn ? 'flex-direction:row-reverse;' : '') + '">';
    html += '<img class="avatar" src="' + safeAvatar + '" alt="' + safeSenderName + '" style="width:32px;height:32px;border-radius:50%;object-fit:cover;background:var(--color-border);flex-shrink:0;border:1px solid var(--color-border-light);">';
    html += '<span class="sender-name" style="font-size:0.75rem;font-weight:var(--font-weight-medium);color:var(--color-text-secondary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:120px;">' + safeSenderName + '</span>';
    html += '</div>';

    html += '<div style="display:flex;align-items:center;gap:4px;max-width:80%;' + (isOwn ? 'flex-direction:row-reverse;' : '') + '">';
    html += '<div class="group-message-bubble" data-plugin-slot="message-bubble" style="background:' + (isOwn ? 'var(--color-primary-gradient)' : 'var(--color-bg-primary)') + ';padding:0.4rem 0.7rem 0.2rem 0.7rem;border-radius:var(--radius-lg);' + (isOwn ? 'border-bottom-left-radius:var(--radius-lg);border-bottom-right-radius:var(--radius-xs);' : 'border-bottom-left-radius:var(--radius-xs);') + 'box-shadow:var(--shadow-sm);border:1px solid ' + (isOwn ? 'var(--color-primary)' : 'var(--color-border-light)') + ';word-wrap:break-word;max-width:100%;color:' + (isOwn ? '#fff' : 'var(--color-text-primary)') + ';">';
    html += '<div class="content" style="font-size:inherit;line-height:1.5;word-break:break-word;">' + content + '</div>';
    html += '<div class="timestamp" style="font-size:0.55rem;color:' + (isOwn ? 'rgba(255,255,255,0.7)' : 'var(--color-text-muted)') + ';margin-top:0.1rem;text-align:right;">' + safeTime + '</div>';
    html += '</div>';
    if (speakBtnHtml) html += speakBtnHtml;
    html += '<div class="message-plugin-actions" data-plugin-slot="message-actions" style="display:contents;"></div>';
    html += '</div>';
    html += '</div>';
  }

  container.innerHTML = html;

  container.querySelectorAll('.group-message .speak-btn').forEach(function (btn) {
    var msgEl = btn.closest('.group-message');
    if (!msgEl) return;
    var msgId = msgEl.dataset.id;
    var msg = messages.find(function (m) { return m.id === msgId; });
    if (!msg) return;
    btn.addEventListener('click', function (e) {
      e.stopPropagation();
      var state = getAppState();
      var chars = state.get('characters') || [];
      var character = chars.find(function (c) { return c.id === msg.senderId; });
      var cleanText = getCleanContentFromElement(msgEl, '.group-message-bubble');
      var msgObj = { id: msgId, content: cleanText, senderType: msg.senderType, senderId: msg.senderId };
      speakGroupMessage(msgObj, character);
    });
    btn.addEventListener('mouseenter', function () {
      if (!btn.classList.contains('speaking')) {
        btn.style.color = 'var(--color-primary)';
        btn.style.opacity = '1';
        btn.style.transform = 'scale(1.05)';
      }
    });
    btn.addEventListener('mouseleave', function () {
      if (!btn.classList.contains('speaking')) {
        btn.style.color = 'var(--color-text-muted)';
        btn.style.opacity = '0.4';
        btn.style.transform = 'scale(1)';
      }
    });
  });

  var msgElements = container.querySelectorAll('.group-message');
  for (var elIdx = 0; elIdx < msgElements.length; elIdx++) {
    var el = msgElements[elIdx];
    if (el.dataset.temp === 'true') continue;
    var msgId = el.dataset.id;
    if (!msgId) continue;
    var msg = messages.find(function (m) { return m.id === msgId; });
    if (!msg) continue;
    el.__utopia_msg = msg;
    addTouchLongPress(el);
  }

  scrollToBottom();
}

function addTouchLongPress(el) {
  var pressTimer = null;
  var startX = 0, startY = 0;

  el.addEventListener('touchstart', function (e) {
    var touch = e.touches[0];
    startX = touch.clientX;
    startY = touch.clientY;
    pressTimer = setTimeout(function () {
      contextMenuRegistry.trigger(el, startX, startY);
    }, 600);
  }, { passive: true });

  el.addEventListener('touchmove', function (e) {
    var touch = e.touches[0];
    var dx = touch.clientX - startX;
    var dy = touch.clientY - startY;
    if (Math.abs(dx) > 10 || Math.abs(dy) > 10) {
      clearTimeout(pressTimer);
    }
  }, { passive: true });

  el.addEventListener('touchend', function () {
    clearTimeout(pressTimer);
  }, { passive: true });

  el.addEventListener('touchcancel', function () {
    clearTimeout(pressTimer);
  }, { passive: true });
}

function updateHeader(group, memberCount) {
  var nameEl = document.getElementById('charName');
  var relationEl = document.getElementById('charRelation');
  var avatarEl = document.getElementById('charAvatar');
  if (nameEl) nameEl.textContent = '👥 ' + group.name;
  if (relationEl) relationEl.textContent = (memberCount ?? 0) + ' 人';
  if (avatarEl) avatarEl.src = group.avatar || 'data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' width=\'40\' height=\'40\' viewBox=\'0 0 40 40\'%3E%3Ccircle cx=\'20\' cy=\'20\' r=\'20\' fill=\'%236c5ce7\'/%3E%3Ctext x=\'20\' y=\'26\' text-anchor=\'middle\' fill=\'%23fff\' font-size=\'18\' font-family=\'sans-serif\'%3E👥%3C/text%3E%3C/svg%3E';
}

function scrollToBottom() {
  if (container) container.scrollTop = container.scrollHeight;
}

export function appendGroupMessage(msg) {
  if (!container) return;

  if (msg._temp && msg.id) {
    markGroupStreaming(msg.id);
  }

  var emptyMsg = container.querySelector('.empty-msg');
  if (emptyMsg) emptyMsg.remove();

  var senderName = msg.senderName || (msg.senderType === 'user' ? '用户' : (msg.senderId || '角色'));
  var avatar = 'data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' width=\'32\' height=\'32\' viewBox=\'0 0 32 32\'%3E%3Ccircle cx=\'16\' cy=\'16\' r=\'16\' fill=\'%23e0e0e6\'/%3E%3Ctext x=\'16\' y=\'22\' text-anchor=\'middle\' fill=\'%238a8aaa\' font-size=\'12\' font-family=\'sans-serif\'%3E?%3C/text%3E%3C/svg%3E';
  var time = formatTime(msg.timestamp || Date.now());
  var isOwn = msg.senderType === 'user';
  var messageRole = isOwn ? 'user' : 'assistant';
  var content = msg.content || '';

  var safeMsgId = escapeHtml(msg.id);
  var safeSenderName = escapeHtml(senderName);
  var safeAvatar = escapeHtml(avatar);
  var safeTime = escapeHtml(time);
  var safeMessageRole = escapeHtml(messageRole);

  var html = '<div class="group-message ' + (isOwn ? 'own' : '') + '" ' +
    'data-id="' + safeMsgId + '" ' +
    'data-temp="true" ' +
    'data-plugin-slot="message" ' +
    'data-message-id="' + safeMsgId + '" ' +
    'data-message-role="' + safeMessageRole + '" ' +
    'style="display:flex;flex-direction:column;align-items:' + (isOwn ? 'flex-end' : 'flex-start') + ';width:100%;">';
  html += '<div style="display:flex;align-items:center;gap:0.5rem;' + (isOwn ? 'flex-direction:row-reverse;' : '') + '">';
  html += '<img class="avatar" src="' + safeAvatar + '" alt="' + safeSenderName + '" style="width:32px;height:32px;border-radius:50%;object-fit:cover;background:var(--color-border);flex-shrink:0;border:1px solid var(--color-border-light);">';
  html += '<span class="sender-name" style="font-size:0.75rem;font-weight:var(--font-weight-medium);color:var(--color-text-secondary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:120px;">' + safeSenderName + '</span>';
  html += '</div>';
  html += '<div style="display:flex;align-items:center;gap:4px;max-width:80%;' + (isOwn ? 'flex-direction:row-reverse;' : '') + '">';
  html += '<div class="group-message-bubble" data-plugin-slot="message-bubble" style="background:' + (isOwn ? 'var(--color-primary-gradient)' : 'var(--color-bg-primary)') + ';padding:0.4rem 0.7rem 0.2rem 0.7rem;border-radius:var(--radius-lg);' + (isOwn ? 'border-bottom-left-radius:var(--radius-lg);border-bottom-right-radius:var(--radius-xs);' : 'border-bottom-left-radius:var(--radius-xs);') + 'box-shadow:var(--shadow-sm);border:1px solid ' + (isOwn ? 'var(--color-primary)' : 'var(--color-border-light)') + ';word-wrap:break-word;max-width:100%;color:' + (isOwn ? '#fff' : 'var(--color-text-primary)') + ';">';
  html += '<div class="content" style="font-size:inherit;line-height:1.5;word-break:break-word;">' + renderMarkdown(content) + '</div>';
  html += '<div class="timestamp" style="font-size:0.55rem;color:' + (isOwn ? 'rgba(255,255,255,0.7)' : 'var(--color-text-muted)') + ';margin-top:0.1rem;text-align:right;">' + safeTime + '</div>';
  html += '</div>';
  html += '<div class="message-plugin-actions" data-plugin-slot="message-actions" style="display:contents;"></div>';
  html += '</div>';
  html += '</div>';

  container.insertAdjacentHTML('beforeend', html);

  var newEl = container.lastElementChild;
  if (newEl) {
    newEl.__utopia_msg = msg;
    addTouchLongPress(newEl);
  }

  scrollToBottom();
}

export function updateGroupMessageContent(msgId, content) {
  if (!container) return;
  var el = container.querySelector('.group-message[data-id="' + msgId + '"]');
  if (!el) {
    if (_streamingMsgIds.has(msgId)) {
      console.debug('[GroupChatUI] 流式消息元素丢失:', msgId);
    }
    return;
  }
  var contentEl = el.querySelector('.content');
  if (contentEl) {
    contentEl.innerHTML = renderMarkdownStream(content, false);
    if (el.__utopia_msg) el.__utopia_msg.content = content;
    scrollToBottom();
  }
}

export function removeGroupMessage(msgId) {
  if (!container) return;
  var el = container.querySelector('.group-message[data-id="' + msgId + '"]');
  if (el) el.remove();
  unmarkGroupStreaming(msgId);
}

async function buildGroupMessageMenuItems(msg) {
  if (!msg) return [];

  const state = getAppState();
  const groupId = state.get('currentGroupId');
  if (!groupId) return [];

  const items = [];

  items.push({
    label: '📋 复制内容',
    action: () => copyToClipboard(msg.content),
  });

  if (msg.senderType === 'character') {
    const characters = state.get('characters') || [];
    const character = characters.find(c => c.id === msg.senderId);
    const name = character ? character.name : msg.senderId;

    items.push({
      label: '@' + name,
      action: () => insertAtMentionByName(name),
    });

    if (msg.content && msg.content.trim().length > 0 && hasSpeakableContent(msg.content)) {
      const el = container && container.querySelector('.group-message[data-id="' + msg.id + '"]');
      let fullContent = msg.content;
      if (el) {
        const cleanText = getCleanContentFromElement(el, '.group-message-bubble');
        if (cleanText.length > fullContent.length) fullContent = cleanText;
      }
      const isPlaying = isSpeaking() && window._speakingGroupMsgId === msg.id;
      items.push({
        label: isPlaying ? '⏹️ 停止朗读' : '🔊 朗读消息',
        action: () => {
          const msgObj = {
            id: msg.id,
            content: fullContent,
            senderType: msg.senderType,
            senderId: msg.senderId,
          };
          speakGroupMessage(msgObj, character);
        },
      });
    }

    let isOwner = false;
    try {
      const role = await getUserRoleInGroup(groupId);
      isOwner = role === 'owner';
    } catch (_) {}

    if (isOwner) {
      items.push({
        label: '🔇 禁言 10 分钟',
        action: () => muteGroupMember(groupId, msg.senderId, 600),
      });
      items.push({
        label: '🚫 移出群聊',
        action: () => {
          if (confirm('确定将 ' + name + ' 移出群聊吗？')) {
            removeGroupMember(groupId, msg.senderId);
          }
        },
      });
    }
  }

  if (msg.senderType === 'user') {
    items.push({
      label: '↩️ 撤回消息',
      action: async () => {
        const result = await undoLastUserMessage(groupId);
        if (result.success) {
          showToast('已撤回', 'success');
          await renderMessages(groupId, { force: true });
        } else {
          showToast('撤回失败: ' + result.reason, 'error');
        }
      },
    });
  }

  if (msg.senderType === 'character') {
    try {
      const allMessages = await getGroupMessages(groupId, 50);
      const idx = allMessages.findIndex(m => m.id === msg.id);
      let userMsg = null;
      for (let i = idx - 1; i >= 0; i--) {
        if (allMessages[i].senderType === 'user') {
          userMsg = allMessages[i];
          break;
        }
      }
      if (userMsg) {
        items.push({
          label: '🔄 重新生成',
          action: async () => {
            const result = await regenerateGroupReply(groupId, msg.id, userMsg.content);
            if (result.success) {
              showToast('已重新生成', 'success');
              await renderMessages(groupId, { force: true });
            } else {
              showToast('重新生成失败: ' + result.reason, 'error');
            }
          },
        });
      }
    } catch (e) {
      console.warn('[GroupChatUI] 构建"重新生成"菜单项失败，跳过:', e);
    }
  }

  return items;
}

function copyToClipboard(text) {
  navigator.clipboard.writeText(text).then(function () {
    showToast('已复制到剪贴板', 'success');
  }).catch(function () {
    var textarea = document.createElement('textarea');
    textarea.value = text;
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand('copy');
    textarea.remove();
    showToast('已复制到剪贴板', 'success');
  });
}

function insertAtMentionByName(name) {
  var input = document.getElementById('messageInput');
  if (!input) return;
  var mention = '@' + name + ' ';
  var start = input.selectionStart || 0;
  var end = input.selectionEnd || 0;
  var text = input.value;
  input.value = text.substring(0, start) + mention + text.substring(end);
  input.focus();
  input.selectionStart = input.selectionEnd = start + mention.length;
}

function initMentionPicker() {
  var input = document.getElementById('messageInput');
  if (!input) return;
  var lastAtPos = -1;
  var pickerOpen = false;

  input.addEventListener('input', async function (e) {
    var val = input.value;
    var cursorPos = input.selectionStart;
    var atIndex = val.lastIndexOf('@', cursorPos - 1);
    if (atIndex !== -1 && (atIndex === 0 || val[atIndex - 1] === ' ' || val[atIndex - 1] === '\n')) {
      if (pickerOpen) return;
      lastAtPos = atIndex;
      var groupId = getAppState().get('currentGroupId');
      if (!groupId) return;
      var members = await getGroupMembers(groupId);
      var characters = members
        .filter(function (m) { return m.memberType === 'character' && m.character; })
        .map(function (m) { return m.character; });
      if (characters.length === 0) return;
      showMentionPicker(characters, function (selectedChar) {
        var before = val.substring(0, lastAtPos);
        var after = val.substring(cursorPos);
        var mention = '@' + selectedChar.name + ' ';
        input.value = before + mention + after;
        input.focus();
        input.selectionStart = input.selectionEnd = before.length + mention.length;
        pickerOpen = false;
      });
      pickerOpen = true;
    } else {
      if (pickerOpen) {
        closeMentionPicker();
        pickerOpen = false;
      }
    }
  });
}

function showMentionPicker(characters, onSelect) {
  var existing = document.querySelector('.mention-picker');
  if (existing) existing.remove();

  var picker = document.createElement('div');
  picker.className = 'mention-picker';
  var list = document.createElement('ul');

  characters.forEach(function (char) {
    var li = document.createElement('li');
    li.textContent = char.name;
    li.addEventListener('click', function () {
      onSelect(char);
      picker.remove();
    });
    list.appendChild(li);
  });

  picker.appendChild(list);
  var input = document.getElementById('messageInput');
  var rect = input.getBoundingClientRect();
  picker.style.position = 'fixed';
  picker.style.left = rect.left + 'px';
  picker.style.top = (rect.top - 150) + 'px';
  picker.style.width = Math.min(rect.width, 300) + 'px';
  picker.style.maxHeight = '150px';
  picker.style.overflowY = 'auto';
  document.body.appendChild(picker);

  var closeHandler = function (e) {
    if (!picker.contains(e.target) && e.target !== input) {
      picker.remove();
      document.removeEventListener('click', closeHandler);
    }
  };
  setTimeout(function () { document.addEventListener('click', closeHandler); }, 10);
}

export function closeMentionPicker() {
  var picker = document.querySelector('.mention-picker');
  if (picker) picker.remove();
}

contextMenuRegistry.register('.group-message', (target) => {
  if (target.dataset.temp === 'true') return [];
  const msg = target.__utopia_msg;
  if (!msg) return [];
  return buildGroupMessageMenuItems(msg);
}, { priority: 50 });