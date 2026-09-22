// js/ui/screens/chatUI.js
import { getStores } from '../../core/db.js';
import { getAppState } from '../../core/state.js';
import { getCurrentCharacter } from '../../modules/character.js';
import { renderMarkdown, renderMarkdownStream, initCodeCopyHandler } from '../components/markdown.js';
import { formatTime } from '../../core/utils.js';
import { generateSuggestedReplies, showSuggestionsUI } from '../../modules/suggestions.js';
import { showToast } from '../components/toast.js';
import { isSpeaking } from '../../services/ttsService.js';
import { createMessageSpeechHandler } from '../../utils/messageSpeech.js';
import { getCleanContentFromElement, hasSpeakableContent } from '../../utils/messageUtils.js';
import { getInjectedMessageActions } from '../../plugins/uiBridge.js';
import { getRenderer } from '../../plugins/uiRuntime.js';
import * as contextMenuRegistry from '../components/contextMenuRegistry.js';

let container = null;

// 消息朗读 handler（CLEAN-1 抽取，统一到 utils/messageSpeech.js）
const speechHandler = createMessageSpeechHandler({
  messageSelector: '.message',
  bubbleSelector: '.bubble',
  stateKey: '_speakingMsgId',
  getContainer: () => container,
  resolveCharacter: (msg, character) => {
    let target = character || getCurrentCharacter();
    if (target && target.id) {
      const chars = getAppState().get('characters') || [];
      const latest = chars.find(c => c.id === target.id);
      if (latest) target = latest;
    }
    return target;
  },
  logPrefix: '[TTS]',
});

export function setChatContainer(el) {
  container = el;
  if (el) {
    initCodeCopyHandler(el);
  }
}

export function scrollToBottom() {
  if (container) container.scrollTop = container.scrollHeight;
}

function isNearBottom(threshold = 80) {
  if (!container) return true;
  const distance = container.scrollHeight - container.scrollTop - container.clientHeight;
  return distance < threshold;
}

function setBackground(bgUrl) {
  if (!container) return;
  if (bgUrl) {
    container.style.backgroundImage = 'url(' + bgUrl + ')';
    container.style.backgroundSize = 'cover';
    container.style.backgroundPosition = 'center';
    container.style.backgroundRepeat = 'no-repeat';
    container.style.backgroundColor = 'var(--color-bg-secondary)';
  } else {
    container.style.backgroundImage = 'none';
    container.style.backgroundColor = 'var(--color-bg-secondary)';
  }
}

const AVATAR_PLACEHOLDER = 'data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' width=\'32\' height=\'32\' viewBox=\'0 0 32 32\'%3E%3Ccircle cx=\'16\' cy=\'16\' r=\'16\' fill=\'%23e0e0e6\'/%3E%3Ctext x=\'16\' y=\'22\' text-anchor=\'middle\' fill=\'%238a8aaa\' font-size=\'12\' font-family=\'sans-serif\'%3E?%3C/text%3E%3C/svg%3E';

function speakMessage(msg, character) {
  return speechHandler.speak(msg, character);
}

function updateSpeakButtonState(msgId, isPlaying) {
  return speechHandler.updateButtonState(msgId, isPlaying);
}

function createSpeakButton() {
  const btn = document.createElement('button');
  btn.className = 'speak-btn icon-btn';
  btn.style.cssText = 'flex-shrink: 0; align-self: center; width: 32px; height: 32px; font-size: 0.85rem; color: var(--color-text-muted); opacity: 0.4; transition: opacity 0.2s, color 0.2s, transform 0.15s; background: var(--color-bg-secondary); border: 1px solid var(--color-border); border-radius: 50%; cursor: pointer; display: flex; align-items: center; justify-content: center; margin-top: 4px;';
  btn.innerHTML = '<i class="fas fa-volume-up"></i>';
  btn.title = '朗读此消息';

  btn.addEventListener('mouseenter', function () {
    btn.style.opacity = '1';
    btn.style.color = 'var(--color-primary)';
    btn.style.transform = 'scale(1.05)';
  });
  btn.addEventListener('mouseleave', function () {
    if (!btn.classList.contains('speaking')) {
      btn.style.opacity = '0.4';
      btn.style.color = 'var(--color-text-muted)';
      btn.style.transform = 'scale(1)';
    }
  });
  btn.addEventListener('click', function (e) {
    e.stopPropagation();
    const latestChar = getCurrentCharacter();
    const msgEl = this.closest('.message');
    const msgId = msgEl.dataset.id;
    const cleanText = getCleanContentFromElement(msgEl, '.bubble');
    const msgObj = { id: msgId, content: cleanText, role: 'assistant' };
    speakMessage(msgObj, latestChar);
  });

  return btn;
}

function buildMessageElement(msg) {
  const div = document.createElement('div');
  div.className = 'message ' + msg.role;
  div.dataset.id = msg.id;
  div.dataset.pluginSlot = 'message';
  div.dataset.messageId = msg.id;
  div.dataset.messageRole = msg.role;
  div.style.display = 'flex';
  div.style.alignItems = 'flex-start';
  div.style.gap = '6px';
  div.style.width = '100%';
  div.__utopia_msg = msg;

  const state = getAppState();
  const settings = state.get('settings');
  const char = getCurrentCharacter();

  const avatar = document.createElement('img');
  avatar.className = 'avatar';
  if (msg.role === 'user') {
    avatar.src = settings.user && settings.user.avatar ? settings.user.avatar : AVATAR_PLACEHOLDER;
  } else {
    avatar.src = char && char.avatar ? char.avatar : AVATAR_PLACEHOLDER;
  }
  avatar.alt = msg.role;
  avatar.style.flexShrink = '0';

  avatar.addEventListener('error', function onAvatarError() {
    this.removeEventListener('error', onAvatarError);
    this.src = AVATAR_PLACEHOLDER;
  });

  const bubble = document.createElement('div');
  bubble.className = 'bubble';
  bubble.dataset.pluginSlot = 'message-bubble';
  bubble.style.flex = '0 1 auto';
  bubble.style.minWidth = '0';

  const contentEl = document.createElement('div');
  contentEl.className = 'bubble-content';

  const baseRender = function (m) {
    return renderMarkdown(m.content);
  };
  const finalRender = getRenderer('message-bubble', baseRender);
  try {
    const rendered = finalRender(msg);
    if (typeof rendered === 'string') {
      contentEl.innerHTML = rendered;
    } else if (rendered instanceof Node) {
      contentEl.appendChild(rendered);
    } else {
      contentEl.innerHTML = baseRender(msg);
    }
  } catch (err) {
    console.warn('[ChatUI] 气泡渲染器失败，回退默认:', err);
    contentEl.innerHTML = baseRender(msg);
  }
  bubble.appendChild(contentEl);

  const time = document.createElement('div');
  time.className = 'timestamp';
  time.textContent = formatTime(msg.timestamp);
  bubble.appendChild(time);

  let speakBtn = null;
  if (msg.role === 'assistant' && msg.content && msg.content.trim().length > 0 && hasSpeakableContent(msg.content)) {
    speakBtn = createSpeakButton();
  }

  const actionsArea = document.createElement('div');
  actionsArea.className = 'message-plugin-actions';
  actionsArea.dataset.pluginSlot = 'message-actions';
  actionsArea.style.cssText = 'display: contents;';

  if (msg.role === 'user') {
    div.style.flexDirection = 'row-reverse';
    div.appendChild(avatar);
    div.appendChild(bubble);
    div.appendChild(actionsArea);
    bubble.style.maxWidth = '100%';
  } else {
    div.style.flexDirection = 'row';
    div.appendChild(avatar);
    div.appendChild(bubble);
    if (speakBtn) {
      div.appendChild(speakBtn);
      bubble.style.maxWidth = 'calc(100% - 44px)';
    } else {
      bubble.style.maxWidth = '100%';
    }
    div.appendChild(actionsArea);
  }

  addTouchLongPress(div);
  return div;
}

// 长按触发右键菜单（移动端）。桌面端右键由 contextMenuRegistry 统一处理。
function addTouchLongPress(el) {
  let pressTimer = null;
  let startX = 0, startY = 0;

  el.addEventListener('touchstart', function (e) {
    const touch = e.touches[0];
    startX = touch.clientX;
    startY = touch.clientY;
    pressTimer = setTimeout(function () {
      contextMenuRegistry.trigger(el, startX, startY);
    }, 600);
  }, { passive: true });

  el.addEventListener('touchmove', function (e) {
    const touch = e.touches[0];
    const dx = touch.clientX - startX;
    const dy = touch.clientY - startY;
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

// ============================================================
// 核心菜单项构建
// ============================================================
function buildCoreMessageMenuItems(msg) {
  if (!msg) return [];
  const items = [];

  if (msg.role === 'user') {
    items.push({
      label: '✏️ 编辑消息',
      action: function () { handleEdit(msg); },
    });
    items.push({
      label: '↩️ 撤回此消息',
      action: function () { handleUndo(msg); },
    });
  } else if (msg.role === 'assistant') {
    items.push({
      label: '🔄 重新生成',
      action: function () { handleRegenerate(msg); },
    });
    items.push({
      label: '📋 复制内容',
      action: function () { handleCopy(msg); },
    });
    if (msg.content && msg.content.trim().length > 0 && hasSpeakableContent(msg.content)) {
      const el = container && container.querySelector('.message[data-id="' + msg.id + '"]');
      let fullContent = msg.content;
      if (el) {
        const cleanText = getCleanContentFromElement(el, '.bubble');
        if (cleanText.length > fullContent.length) {
          fullContent = cleanText;
        }
      }
      const isPlaying = isSpeaking() && window._speakingMsgId === msg.id;
      items.push({
        label: isPlaying ? '⏹️ 停止朗读' : '🔊 朗读消息',
        action: function () {
          const latestChar = getCurrentCharacter();
          const fullMsg = { id: msg.id, content: fullContent, role: 'assistant' };
          speakMessage(fullMsg, latestChar);
        },
      });
    }
  }

  items.push({
    label: '💡 推荐回复',
    action: function () { handleSuggestions(msg); },
  });

  // 兼容旧 injectMessageAction API
  try {
    const pluginActions = getInjectedMessageActions();
    if (pluginActions && pluginActions.length > 0) {
      items.push({
        label: '─── 插件操作 ───',
        action: function () {},
        _disabled: true,
      });
      for (const entry of pluginActions) {
        const config = entry.config;
        items.push({
          label: config.label,
          action: function () {
            try {
              const state = getAppState();
              const pluginContext = {
                conversationId: state.get('currentConversationId'),
                character: getCurrentCharacter(),
                api: window.__utopiaApi || null,
                reloadMessages: async () => {
                  const convId = state.get('currentConversationId');
                  if (convId) {
                    const { renderConversation } = await import('../../modules/chat.js');
                    await renderConversation(convId);
                  }
                },
              };
              config.onClick(msg, pluginContext);
            } catch (err) {
              console.error(`[Plugin:${entry.pluginId}] 消息操作失败:`, err);
              showToast('插件操作失败: ' + err.message, 'error');
            }
          },
        });
      }
    }
  } catch (err) {
    console.warn('[ChatUI] 加载插件菜单失败:', err);
  }

  return items;
}

// ============================================================
// 兼容 API：showContextMenu
// ============================================================
export function showContextMenu(x, y, msg) {
  const items = buildCoreMessageMenuItems(msg);
  if (items.length === 0) return;
  contextMenuRegistry.show(items, x, y);
}

async function getChatOperations() {
  const mod = await import('../../modules/chatOperations.js');
  if (typeof mod.regenerateLastReply !== 'function') {
    console.error('[ChatUI] chatOperations.js 未正确导出，模块内容:', Object.keys(mod));
    throw new Error('chatOperations 模块加载异常，请刷新页面重试');
  }
  return mod;
}

async function handleUndo(msg) {
  const convId = getAppState().get('currentConversationId');
  if (!convId) { showToast('未找到当前会话', 'warning'); return; }
  try {
    const { undoLastMessage } = await getChatOperations();
    const result = await undoLastMessage(convId);
    if (result.success) {
      showToast('已撤回', 'success');
    } else {
      showToast('撤回失败: ' + result.reason, 'error');
    }
  } catch (err) {
    console.error('[ChatUI] 撤回失败:', err);
    showToast('撤回失败: ' + err.message, 'error');
  }
}

async function handleRegenerate(msg) {
  const convId = getAppState().get('currentConversationId');
  if (!convId) { showToast('未找到当前会话', 'warning'); return; }
  try {
    const { regenerateLastReply } = await getChatOperations();
    const result = await regenerateLastReply(convId);
    if (result.success) {
      showToast('已重新生成', 'success');
    } else {
      showToast('重新生成失败: ' + result.reason, 'error');
    }
  } catch (err) {
    console.error('[ChatUI] 重新生成失败:', err);
    showToast('重新生成失败: ' + err.message, 'error');
  }
}

function handleCopy(msg) {
  navigator.clipboard.writeText(msg.content).then(function () {
    showToast('已复制到剪贴板', 'success');
  }).catch(function () {
    const textarea = document.createElement('textarea');
    textarea.value = msg.content;
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand('copy');
    textarea.remove();
    showToast('已复制到剪贴板', 'success');
  });
}

async function handleEdit(msg) {
  const state = getAppState();
  const convId = state.get('currentConversationId');
  if (!convId) {
    showToast('未找到当前会话', 'warning');
    return;
  }

  const stores = await getStores();
  const conv = await stores.conversations.get(convId);
  if (!conv) {
    showToast('会话不存在', 'error');
    return;
  }
  const msgIndex = conv.messages.findIndex(function (m) { return m.id === msg.id; });
  if (msgIndex === -1) {
    showToast('消息不存在', 'error');
    return;
  }
  const isLastUserMessage = !conv.messages
    .slice(msgIndex + 1)
    .some(function (m) { return m.role === 'user'; });

  const result = await showEditDialog(msg.content, isLastUserMessage);
  if (!result) return;

  const newContent = result.content;
  if (newContent === msg.content) return;

  try {
    const { updateMessageInConversation } = await import('../../modules/conversation.js');
    await updateMessageInConversation(convId, msg.id, { content: newContent });

    const char = getCurrentCharacter();
    if (char) {
      try {
        const { updateMemoriesByUserMessage } = await import('../../modules/memory.js');
        await updateMemoriesByUserMessage(char.id, msg.content, newContent);
      } catch (e) {
        console.warn('[ChatUI] 同步记忆失败（不影响编辑）:', e);
      }
    }

    const msgEl = container && container.querySelector('.message[data-id="' + msg.id + '"]');
    if (msgEl) {
      const bubble = msgEl.querySelector('.bubble');
      if (bubble) {
        const contentEl = bubble.querySelector('.bubble-content');
        if (contentEl) {
          contentEl.innerHTML = renderMarkdown(newContent);
        } else {
          const time = bubble.querySelector('.timestamp');
          bubble.innerHTML = renderMarkdown(newContent);
          if (time) bubble.appendChild(time);
        }
      }
      if (msgEl.__utopia_msg) {
        msgEl.__utopia_msg.content = newContent;
      }
    }

    showToast('已保存', 'success');

    if (result.regenerate) {
      const { regenerateLastReply } = await getChatOperations();
      const regenResult = await regenerateLastReply(convId);
      if (!regenResult.success) {
        showToast('重新生成失败: ' + regenResult.reason, 'error');
      }
    }
  } catch (err) {
    console.error('[ChatUI] 编辑消息失败:', err);
    showToast('编辑失败: ' + err.message, 'error');
  }
}

/**
 * 显示消息编辑对话框
 *
 * @param {string} originalContent
 * @param {boolean} allowRegenerate
 * @returns {Promise<{content: string, regenerate: boolean}|null>}
 */
function showEditDialog(originalContent, allowRegenerate) {
  return new Promise(function (resolve) {
    const escapedContent = String(originalContent)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');

    const regenBtnHtml = allowRegenerate
      ? '<button class="btn btn-primary" id="editSaveRegenBtn">保存并重新生成</button>'
      : '';

    const html =
      '<button class="modal-close">&times;</button>' +
      '<h3 class="modal-title"><i class="fas fa-edit"></i> 编辑消息</h3>' +
      '<div class="form-group">' +
        '<textarea id="editMessageTextarea" rows="6" ' +
          'style="width:100%;font-family:inherit;font-size:inherit;resize:vertical;line-height:1.6;">' +
          escapedContent +
        '</textarea>' +
        '<span class="help-text">修改后点击"仅保存"保留原有 AI 回复，或"保存并重新生成"让 AI 重新回复。</span>' +
      '</div>' +
      '<div style="display:flex;gap:0.5rem;justify-content:flex-end;margin-top:1rem;flex-wrap:wrap;">' +
        '<button class="btn btn-secondary" id="editCancelBtn">取消</button>' +
        '<button class="btn btn-primary" id="editSaveBtn">仅保存</button>' +
        regenBtnHtml +
      '</div>';

    // ---- 结果保护：防止重复 resolve ----
    let settled = false;
    function safeResolve(value) {
      if (settled) return;
      settled = true;
      resolve(value);
    }

    // ---- 用户意图：默认 null（等价于取消） ----
    let pendingValue = null;

    import('../components/modal.js').then(function (m) {
      m.openModal(html, () => {
        safeResolve(pendingValue);
      });

      const modalContent = document.getElementById('modalContent');
      if (!modalContent) {
        try { m.closeModal(); } catch (_) {
          safeResolve(null);
        }
        return;
      }

      const textarea = modalContent.querySelector('#editMessageTextarea');
      if (textarea) {
        textarea.focus();
        textarea.setSelectionRange(textarea.value.length, textarea.value.length);

        textarea.addEventListener('keydown', function (e) {
          if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
            e.preventDefault();
            const val = textarea.value.trim();
            if (!val) {
              showToast('内容不能为空', 'warning');
              return;
            }
            pendingValue = { content: val, regenerate: false };
            m.closeModal();
          }
        });
      }

      const cancelBtn = modalContent.querySelector('#editCancelBtn');
      if (cancelBtn) {
        cancelBtn.addEventListener('click', function () {
          // pendingValue 保持默认 null
          m.closeModal();  // → 触发 onClose → safeResolve(null)
        });
      }

      const saveBtn = modalContent.querySelector('#editSaveBtn');
      if (saveBtn) {
        saveBtn.addEventListener('click', function () {
          const val = textarea ? textarea.value.trim() : '';
          if (!val) {
            showToast('内容不能为空', 'warning');
            return;
          }
          pendingValue = { content: val, regenerate: false };
          m.closeModal();  // → 触发 onClose → safeResolve({ content, regenerate: false })
        });
      }

      const regenBtn = modalContent.querySelector('#editSaveRegenBtn');
      if (regenBtn) {
        regenBtn.addEventListener('click', function () {
          const val = textarea ? textarea.value.trim() : '';
          if (!val) {
            showToast('内容不能为空', 'warning');
            return;
          }
          pendingValue = { content: val, regenerate: true };
          m.closeModal();  // → 触发 onClose → safeResolve({ content, regenerate: true })
        });
      }
    }).catch(function (err) {
      console.error('[ChatUI] 加载 modal 失败:', err);
      safeResolve(null);
    });
  });
}

/**
 * 处理"推荐回复"菜单项
 */
async function handleSuggestions(msg) {
  const convId = getAppState().get('currentConversationId');
  if (!convId) { showToast('未找到当前会话', 'warning'); return; }

  const suggestions = await generateSuggestedReplies(convId, msg.content, 4);

  const state = getAppState();
  if (state.get('currentConversationId') !== convId
      || state.get('currentMode') !== 'chat') {
    console.debug('[ChatUI] 推荐回复跳过：目标会话已切换');
    return;
  }

  if (suggestions.length === 0) {
    showToast('暂无推荐回复', 'info');
    return;
  }

  showSuggestionsUI(suggestions, async function (text) {
    const { sendMessage } = await import('../../modules/chat.js');
    await sendMessage(text);
  });
}

export function appendMessage(msg) {
  if (!container) return;
  const wasAtBottom = isNearBottom();
  const el = buildMessageElement(msg);
  container.appendChild(el);
  if (wasAtBottom) {
    scrollToBottom();
  }
}

export function updateMessageContent(msgId, newContent, isComplete = false) {
  if (!container) return;
  const el = container.querySelector('.message[data-id="' + msgId + '"]');
  if (!el) {
    console.debug('[ChatUI] updateMessageContent: 元素未找到', msgId);
    return;
  }

  const wasAtBottom = isNearBottom();
  const bubble = el.querySelector('.bubble');
  if (bubble) {
    const contentEl = bubble.querySelector('.bubble-content');
    if (contentEl) {
      contentEl.innerHTML = renderMarkdownStream(newContent, isComplete);
    } else {
      const time = bubble.querySelector('.timestamp');
      bubble.innerHTML = renderMarkdownStream(newContent, isComplete);
      if (time) bubble.appendChild(time);
    }
  }

  if (el.__utopia_msg) {
    el.__utopia_msg.content = newContent;
  }

  const existingBtn = el.querySelector('.speak-btn');
  const hasDialogue = hasSpeakableContent(newContent);

  if (el.classList.contains('assistant') && hasDialogue && !existingBtn) {
    const btn = createSpeakButton();
    const actionsArea = el.querySelector('.message-plugin-actions');
    if (actionsArea) {
      el.insertBefore(btn, actionsArea);
    } else {
      el.appendChild(btn);
    }
    if (bubble) bubble.style.maxWidth = 'calc(100% - 44px)';
  } else if (el.classList.contains('assistant') && !hasDialogue && existingBtn) {
    existingBtn.remove();
    if (bubble) bubble.style.maxWidth = '100%';
  }

  if (wasAtBottom) {
    scrollToBottom();
  }
}

export function removeMessage(msgId) {
  if (!container) return;
  const el = container.querySelector('.message[data-id="' + msgId + '"]');
  if (el) el.remove();
}

export function renderConversationData(convData) {
  if (!container) return;
  if (!convData) return;

  container.className = '';
  container.style.backgroundImage = '';

  const char = getCurrentCharacter();
  setBackground(char && char.chatBg ? char.chatBg : null);

  container.innerHTML = '';
  for (let i = 0; i < convData.messages.length; i++) {
    const msg = convData.messages[i];
    const el = buildMessageElement(msg);
    container.appendChild(el);
  }
  scrollToBottom();
}

export async function renderConversation(convId) {
  const stores = await getStores();
  const convData = await stores.conversations.get(convId);
  if (!convData) return;
  renderConversationData(convData);
}

// ============================================================
// 注册核心消息菜单 provider
// ============================================================
contextMenuRegistry.register('.message', (target) => {
  const messageEl = target.matches('.message') ? target : target.closest('.message');
  const msg = messageEl && messageEl.__utopia_msg;
  if (!msg) return [];
  return buildCoreMessageMenuItems(msg);
}, { priority: 50 });