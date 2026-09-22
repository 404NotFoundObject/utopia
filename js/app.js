// js/app.js
import { getAppState } from './core/state.js';
import { loadSettings } from './modules/settings.js';
import { loadCharacters, syncAllCharactersState, syncCharacterState, getCurrentCharacter } from './modules/character.js';
import { setChatContainer } from './modules/chat.js';
import { updateInjectorRules } from './modules/injector.js';
import { initMemoryIndex } from './modules/memory.js';
import { initTime, syncTime, flushToDB as flushTimeToDB } from './modules/time.js';
import { checkAutoPost } from './modules/social.js';
import globalEventBus from './core/eventBus.js';
import { checkDatabase, deleteDatabase, getStores } from './core/db.js';
import { generateUUID } from './core/utils.js';
import { openModal, closeModal } from './ui/components/modal.js';
import { showToast } from './ui/components/toast.js';

import { initTheme, bindThemeToggle } from './ui/layout/theme.js';
import { initSidebar } from './ui/layout/sidebar.js';
import { renderCharacterList, initCharacterListSubscription, updateCharacterHighlight } from './ui/screens/characterListUI.js';
import { renderCharacterForm } from './ui/screens/characterFormUI.js';
import { renderImportModal } from './ui/screens/importUI.js';
import { openSocialFeed } from './ui/screens/socialUI.js';
import { renderSettingsModal, bindSettingsSave } from './ui/screens/settingsUI.js';

import {
  startListening,
  stopListening,
  getFinalTranscript,
  getInterimTranscript,
  isCurrentlyListening,
  isSpeechSupported,
} from './services/sttService.js';

const APP_VERSION = '3.7.1';
const STORAGE_VERSION_KEY = 'utopia_app_version';
const PENDING_CALL_END_KEY = 'utopia:pending-call-end';

let _stopProactiveChat = null;
let _hangupCurrentCall = null;
// _hangupCurrentCallSync：同步挂断引用，仅用于 beforeunload。
// 只写 pending + 关闭 UI，消息落库交给 recoverPendingCallEnd 补偿。
let _hangupCurrentCallSync = null;
let _intervalIds = [];

function checkAppVersion() {
  const storedVersion = localStorage.getItem(STORAGE_VERSION_KEY);
  if (storedVersion && storedVersion !== APP_VERSION) {
    console.log(`🔄 应用版本更新: ${storedVersion} → ${APP_VERSION}`);
    if ('caches' in window) {
      caches.keys().then(keys => {
        keys.forEach(key => caches.delete(key));
      });
    }
    localStorage.setItem(STORAGE_VERSION_KEY, APP_VERSION);
    setTimeout(() => {
      if (confirm(`应用已更新至 v${APP_VERSION}，建议刷新页面以获得最佳体验。`)) {
        location.reload();
      }
    }, 500);
  } else if (!storedVersion) {
    localStorage.setItem(STORAGE_VERSION_KEY, APP_VERSION);
  }
}

function showDbErrorDialog(errorMsg, errorCode) {
  const html = `
    <div style="text-align:center; padding: 1rem 0;">
      <div style="font-size: 3rem; margin-bottom: 1rem;">⚠️</div>
      <h2 style="color: var(--color-danger);">数据库初始化失败</h2>
      <p style="color: var(--color-text-secondary); margin: 1rem 0;">
        检测到数据库损坏或不兼容，无法正常启动。
      </p>
      <div style="background: var(--color-bg-secondary); padding: 0.8rem; border-radius: var(--radius-md); text-align: left; font-family: monospace; font-size: 0.85rem; margin: 1rem 0; overflow-wrap: break-word;">
        <strong>错误信息：</strong> ${errorMsg}<br>
        <strong>错误代码：</strong> ${errorCode || '未知'}
      </div>
      <p style="color: var(--color-text-muted); font-size: 0.9rem;">
        点击下方按钮将<strong style="color: var(--color-danger);">删除所有数据</strong>并重建数据库，此操作不可恢复！
      </p>
      <div style="display: flex; gap: 1rem; justify-content: center; margin-top: 1.5rem;">
        <button class="btn btn-danger" id="rebuildDbBtn" style="padding: 0.6rem 2rem;">
          🗑️ 删除并重建
        </button>
        <button class="btn btn-secondary" id="cancelRebuildBtn" style="padding: 0.6rem 2rem;">
          取消（应用将无法使用）
        </button>
      </div>
    </div>
  `;

  openModal(html);

  document.getElementById('rebuildDbBtn').addEventListener('click', async () => {
    try {
      await deleteDatabase();
      localStorage.removeItem(STORAGE_VERSION_KEY);
      closeModal();
      showToast('数据库已删除，页面即将刷新...', 'info');
      setTimeout(() => location.reload(), 1000);
    } catch (err) {
      console.error('[DB] 重建失败:', err);
      showToast('重建失败: ' + err.message, 'error');
    }
  });

  document.getElementById('cancelRebuildBtn').addEventListener('click', () => {
    closeModal();
    showToast('应用无法初始化，请刷新重试或手动清除数据', 'error');
  });
}

async function recoverPendingCallEnd() {
  let pending = null;
  try {
    const raw = localStorage.getItem(PENDING_CALL_END_KEY);
    if (!raw) return;
    pending = JSON.parse(raw);
  } catch (_) {
    try { localStorage.removeItem(PENDING_CALL_END_KEY); } catch (_) {}
    return;
  }

  try { localStorage.removeItem(PENDING_CALL_END_KEY); } catch (_) {}

  if (!pending || !pending.characterId) return;

  try {
    const stores = await getStores();
    const char = await stores.characters.get(pending.characterId);
    if (!char) {
      console.log('[App] 补偿通话结束：角色不存在，跳过', pending.characterId);
      return;
    }

    // 1. 清除 inCall 状态
    if (char.inCall) {
      try {
        const { updateCharacter } = await import('./modules/character.js');
        await updateCharacter(char.id, { inCall: false }, { skipReload: true });
      } catch (e) {
        console.warn('[App] 补偿：清除 inCall 失败:', e);
      }
    }

    // 2. 写入通话结束系统消息（仅当角色已有会话时）
    const convs = await stores.conversations.getByIndex('characterId', pending.characterId);
    if (convs.length > 0) {
      const latestConv = convs.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))[0];
      const duration = Math.max(0, Number(pending.duration) || 0);


      const endGameTime = Number(pending.endGameTime)
                       || Number(pending.endTime)
                       || Date.now();

      const recent = (latestConv.messages || []).slice(-5);
      const alreadyInserted = recent.some(m =>
        m &&
        m.role === 'system' &&
        typeof m.content === 'string' &&
        m.content.startsWith('📞 通话结束') &&
        Math.abs((Number(m.timestamp) || 0) - endGameTime) < 5000
      );

      if (alreadyInserted) {
        console.log('[App] 补偿通话结束：最新会话中已存在对应记录，跳过插入', pending.characterId);
      } else {
        const minutes = String(Math.floor(duration / 60)).padStart(2, '0');
        const seconds = String(duration % 60).padStart(2, '0');

        try {
          const { addMessageToConversation } = await import('./modules/conversation.js');
          await addMessageToConversation(latestConv.id, {
            id: generateUUID(),
            role: 'system',
            content: `📞 通话结束 (时长 ${minutes}:${seconds})`,
            timestamp: endGameTime,
            isProactive: true,
            isVoice: true,
          });
          console.log('[App] 已补偿上次通话结束记录:', pending.characterId);
        } catch (e) {
          console.warn('[App] 补偿：写入通话结束消息失败:', e);
        }
      }
    } else {
      console.log('[App] 补偿通话结束：角色无会话，仅清除 inCall 状态');
    }

    // 3. 若角色列表已渲染，刷新以同步 inCall 状态
    try {
      const { renderCharacterList } = await import('./ui/screens/characterListUI.js');
      renderCharacterList();
    } catch (_) {}
  } catch (e) {
    console.warn('[App] 补偿上次通话结束失败:', e);
  }
}

function registerInterval(fn, ms) {
  const id = setInterval(() => {
    if (document.hidden) return;
    try {
      fn();
    } catch (e) {
      console.warn('[App] 定时任务异常:', e);
    }
  }, ms);
  _intervalIds.push(id);
  return id;
}

function clearAllIntervals() {
  for (const id of _intervalIds) {
    try { clearInterval(id); } catch (_) {}
  }
  _intervalIds = [];
}

let _wbVectorSyncAttempted = false;
let _wbVectorSyncPollTimer = null;
let _wbVectorSyncListenerBound = false;

function setupWorldBookVectorSync() {
  if (_wbVectorSyncListenerBound) return;
  _wbVectorSyncListenerBound = true;

  globalEventBus.on('memory:vector-init-done', (payload) => {
    console.log('[App] 收到 memory:vector-init-done 事件:', payload);
    if (payload?.ready) {
      triggerWorldBookVectorSync('memory-ready');
    } else {
      console.log('[App] 语义引擎未就绪（事件报告），跳过世界书向量同步');
      _wbVectorSyncAttempted = true;
      stopWbVectorSyncPolling();
    }
  });

  globalEventBus.on('settings:updated', (payload) => {
    const oldId = payload.oldSettings?.semanticModelId;
    const newId = payload.newSettings?.semanticModelId;
    const oldDtype = payload.oldSettings?.semanticDtype;
    const newDtype = payload.newSettings?.semanticDtype;

    if (oldId !== newId || oldDtype !== newDtype) {
      console.log('[App] 语义模型/精度已变更，将在引擎重载后同步世界书向量');
      _wbVectorSyncAttempted = false;
      stopWbVectorSyncPolling();
      startWbVectorSyncPolling();
    }
  });

  startWbVectorSyncPolling();
}

function startWbVectorSyncPolling() {
  if (_wbVectorSyncPollTimer) return;

  let pollCount = 0;
  const maxPolls = 15;
  const pollInterval = 2000;

  _wbVectorSyncPollTimer = setInterval(async () => {
    pollCount++;

    if (_wbVectorSyncAttempted) {
      stopWbVectorSyncPolling();
      return;
    }

    if (pollCount >= maxPolls) {
      console.log('[App] 世界书向量同步轮询超时，放弃');
      stopWbVectorSyncPolling();
      return;
    }

    const ready = await checkVectorEngineReady();
    if (ready) {
      stopWbVectorSyncPolling();
      triggerWorldBookVectorSync('poll');
    }
  }, pollInterval);
}

function stopWbVectorSyncPolling() {
  if (_wbVectorSyncPollTimer) {
    clearInterval(_wbVectorSyncPollTimer);
    _wbVectorSyncPollTimer = null;
  }
}

async function checkVectorEngineReady() {
  try {
    const memory = await import('./modules/memory.js');
    return memory.isVectorReady === true;
  } catch {
    return false;
  }
}

async function triggerWorldBookVectorSync(reason) {
  if (_wbVectorSyncAttempted) return;

  try {
    const state = getAppState();
    const settings = state.get('settings') || {};
    const wbSemantic = settings.worldBookSemantic || {};

    if (wbSemantic.autoSyncVectors === false) {
      console.log('[App] 世界书向量自动同步已禁用');
      _wbVectorSyncAttempted = true;
      return;
    }

    const ready = await checkVectorEngineReady();
    if (!ready) {
      console.log('[App] 语义引擎未就绪，跳过世界书向量同步');
      return;
    }

    if (!settings.semanticModelId) {
      console.log('[App] 未配置语义模型，跳过世界书向量同步');
      _wbVectorSyncAttempted = true;
      return;
    }

    _wbVectorSyncAttempted = true;
    console.log(`[App] 开始同步世界书向量（触发原因: ${reason}）`);

    const { syncWorldBookVectors } = await import('./modules/worldBook.js');
    const result = await syncWorldBookVectors();

    if (result.updated > 0) {
      console.log(`[App] ✅ 世界书向量同步完成：更新 ${result.updated}，跳过 ${result.skipped}`);
      globalEventBus.emit('worldbook:vectors-synced', result);
    } else if (result.skipped > 0) {
      console.log(`[App] 世界书向量已是最新（${result.skipped} 条有效）`);
    } else {
      console.log('[App] 没有需要同步的语义规则');
    }
  } catch (err) {
    _wbVectorSyncAttempted = false;
    console.warn('[App] 世界书向量同步失败:', err);
  }
}

function updateMainView() {
  const state = getAppState();
  const chars = state.get('characters') || [];
  const groups = state.get('groups') || [];
  const hasSelected = state.get('currentCharacterId') !== null || state.get('currentGroupId') !== null;
  const welcome = document.getElementById('welcomePage');
  const chatContainer = document.getElementById('chatContainer');
  const hasContent = chars.length > 0 || groups.length > 0;

  if (hasContent && hasSelected) {
    welcome.style.display = 'none';
    chatContainer.style.display = 'flex';
  } else {
    welcome.style.display = 'flex';
    chatContainer.style.display = 'none';
    document.getElementById('chatMessages').innerHTML = '';
  }
}

function updateHeader() {
  const state = getAppState();
  const char = getCurrentCharacter();
  const groupId = state.get('currentGroupId');
  const nameEl = document.getElementById('charName');
  const relationEl = document.getElementById('charRelation');
  const avatarEl = document.getElementById('charAvatar');
  const header = document.getElementById('characterInfo');

  if (groupId) {
    import('./modules/groupChat.js').then(async (m) => {
      try {
        const group = await m.getGroup(groupId);
        if (group) {
          nameEl.textContent = `👥 ${group.name}`;
          relationEl.textContent = '群聊';
          avatarEl.src = group.avatar || 'data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' width=\'40\' height=\'40\' viewBox=\'0 0 40 40\'%3E%3Ccircle cx=\'20\' cy=\'20\' r=\'20\' fill=\'%236c5ce7\'/%3E%3Ctext x=\'20\' y=\'26\' text-anchor=\'middle\' fill=\'%23fff\' font-size=\'18\' font-family=\'sans-serif\'%3E👥%3C/text%3E%3C/svg%3E';
          header.style.display = 'flex';
        }
      } catch (e) {
        console.warn('[Header] 获取群组信息失败:', e);
      }
    });
    return;
  }

  if (char) {
    nameEl.textContent = char.name;
    let relation = char.relationship || '--';
    if (relation.length > 10) {
      relation = relation.substring(0, 10) + '...';
    }
    relationEl.textContent = relation;
    avatarEl.src = char.avatar || 'data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' width=\'40\' height=\'40\' viewBox=\'0 0 40 40\'%3E%3Ccircle cx=\'20\' cy=\'20\' r=\'20\' fill=\'%23e0e0e6\'/%3E%3Ctext x=\'20\' y=\'26\' text-anchor=\'middle\' fill=\'%238a8aaa\' font-size=\'16\' font-family=\'sans-serif\'%3E?%3C/text%3E%3C/svg%3E';
    header.style.display = 'flex';
  } else {
    nameEl.textContent = '未选择';
    relationEl.textContent = '--';
    avatarEl.src = 'data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' width=\'40\' height=\'40\' viewBox=\'0 0 40 40\'%3E%3Ccircle cx=\'20\' cy=\'20\' r=\'20\' fill=\'%23e0e0e6\'/%3E%3Ctext x=\'20\' y=\'26\' text-anchor=\'middle\' fill=\'%238a8aaa\' font-size=\'16\' font-family=\'sans-serif\'%3E?%3C/text%3E%3C/svg%3E';
    header.style.display = 'none';
  }
}

function bindUIEvents() {
  const sendBtn = document.getElementById('sendBtn');
  const input = document.getElementById('messageInput');

  if (sendBtn && input) {
    const newSendBtn = sendBtn.cloneNode(true);
    sendBtn.parentNode?.replaceChild(newSendBtn, sendBtn);
    const newInput = input.cloneNode(true);
    input.parentNode?.replaceChild(newInput, input);

    function autoResize() {
      newInput.style.height = 'auto';
      const maxHeight = parseInt(getComputedStyle(newInput).maxHeight) || 120;
      const scrollHeight = newInput.scrollHeight;
      if (scrollHeight > maxHeight) {
        newInput.style.height = maxHeight + 'px';
        newInput.style.overflowY = 'auto';
      } else {
        newInput.style.height = scrollHeight + 'px';
        newInput.style.overflowY = 'hidden';
      }
    }
    newInput.addEventListener('input', autoResize);
    newInput.addEventListener('focus', autoResize);

    const micBtn = document.createElement('button');
    micBtn.className = 'mic-btn';
    micBtn.style.cssText = `
      width: 44px;
      height: 44px;
      border-radius: 50%;
      background: var(--color-bg-secondary);
      border: 1.5px solid var(--color-border);
      color: var(--color-text-muted);
      display: flex;
      align-items: center;
      justify-content: center;
      transition: all var(--transition-fast);
      flex-shrink: 0;
      font-size: 1.2rem;
      cursor: pointer;
      margin-left: 4px;
      user-select: none;
    `;
    micBtn.innerHTML = '<i class="fas fa-microphone"></i>';
    micBtn.title = '按住说话 (Ctrl/Alt)';
    const micIcon = micBtn.querySelector('i');

    const inputContainer = newInput.parentNode;
    inputContainer.insertBefore(micBtn, newSendBtn);

    let isMicActive = false;
    let isKeyActive = false;
    let isButtonActive = false;
    let pendingKey = null;
    let pendingKeyTimer = null;

    function updateMicUI(active, processing = false) {
      if (processing) {
        micBtn.style.background = 'var(--color-warning)';
        micBtn.style.borderColor = 'var(--color-warning)';
        micBtn.style.color = '#fff';
        micIcon.className = 'fas fa-spinner fa-spin';
        micBtn.title = '识别中...';
        return;
      }
      if (active) {
        micBtn.style.background = 'var(--color-danger)';
        micBtn.style.borderColor = 'var(--color-danger)';
        micBtn.style.color = '#fff';
        micIcon.className = 'fas fa-microphone-slash';
        micBtn.title = '松开停止录音';
      } else {
        micBtn.style.background = 'var(--color-bg-secondary)';
        micBtn.style.borderColor = 'var(--color-border)';
        micBtn.style.color = 'var(--color-text-muted)';
        micIcon.className = 'fas fa-microphone';
        micBtn.title = '按住说话 (Ctrl/Alt)';
      }
    }

    function startRecording() {
      if (isMicActive) return;
      if (!isSpeechSupported) {
        showToast('浏览器不支持语音识别，请使用 Chrome 或 Edge', 'warning');
        return;
      }

      if (isCurrentlyListening()) {
        showToast('通话进行中，麦克风正被占用。如需语音输入，请先挂断通话', 'warning');
        return;
      }

      newInput.value = '';
      try {
        startListening({
          language: 'zh-CN',
          continuous: false,
          autoRestart: false,
          onResult: (text, isFinal) => {
            newInput.value = text;
          },
          onEnd: () => {
            if (isMicActive) {
              isMicActive = false;
              const final = getFinalTranscript();
              if (final) {
                newInput.value = final;
              } else {
                const interim = getInterimTranscript();
                if (interim) newInput.value = interim;
              }
              updateMicUI(false);
            }
          },
          onError: (error) => {
            console.warn('[STT] 错误:', error);
            if (isMicActive) {
              isMicActive = false;
              updateMicUI(false);
              showToast('语音识别错误: ' + error, 'error');
            }
          },
        });
        isMicActive = true;
        updateMicUI(true);
      } catch (err) {
        showToast('语音启动失败: ' + err.message, 'error');
      }
    }

    function stopRecording(keepResult = true) {
      if (!isMicActive) return;
      stopListening(keepResult);
      isMicActive = false;

      const settings = getAppState().get('settings');
      const isHttpMode = settings?.stt?.provider === 'whisper-http';

      if (isHttpMode && keepResult) {
        updateMicUI(false, true);
        let waited = 0;
        const checkInterval = setInterval(() => {
          waited += 200;
          const final = getFinalTranscript();
          if (final) {
            clearInterval(checkInterval);
            newInput.value = final;
            updateMicUI(false);
          } else if (waited >= 30000) {
            clearInterval(checkInterval);
            updateMicUI(false);
            const interim = getInterimTranscript();
            if (interim) newInput.value = interim;
          }
        }, 200);
      } else {
        updateMicUI(false);
        if (keepResult) {
          const final = getFinalTranscript();
          if (final) {
            newInput.value = final;
          } else {
            const interim = getInterimTranscript();
            if (interim) newInput.value = interim;
          }
        }
      }
    }

    const startPress = (e) => {
      e.preventDefault();
      if (isButtonActive) return;
      isButtonActive = true;
      startRecording();
    };

    const endPress = (e) => {
      e.preventDefault();
      if (!isButtonActive) return;
      isButtonActive = false;
      stopRecording(true);
    };

    micBtn.addEventListener('mousedown', startPress);
    micBtn.addEventListener('mouseup', endPress);
    micBtn.addEventListener('mouseleave', endPress);
    micBtn.addEventListener('touchstart', (e) => {
      e.preventDefault();
      if (isButtonActive) return;
      isButtonActive = true;
      startRecording();
    }, { passive: false });
    micBtn.addEventListener('touchend', (e) => {
      e.preventDefault();
      if (!isButtonActive) return;
      isButtonActive = false;
      stopRecording(true);
    }, { passive: false });
    micBtn.addEventListener('touchcancel', (e) => {
      e.preventDefault();
      if (!isButtonActive) return;
      isButtonActive = false;
      stopRecording(true);
    }, { passive: false });

    const keyDownHandler = (e) => {
      const isCtrl = e.key === 'Control';
      const isAlt = e.key === 'Alt';
      if ((isCtrl || isAlt) && !e.shiftKey && !e.metaKey) {
        if ((e.ctrlKey && !e.altKey) || (!e.ctrlKey && e.altKey)) {
          if (!isMicActive && !pendingKey) {
            pendingKey = e.key;
            if (pendingKeyTimer) clearTimeout(pendingKeyTimer);
            pendingKeyTimer = setTimeout(() => {
              if (pendingKey === e.key) {
                pendingKey = null;
                pendingKeyTimer = null;
                if (!isMicActive) {
                  isKeyActive = true;
                  startRecording();
                }
              }
            }, 200);
          }
        }
      } else {
        if (pendingKey) {
          pendingKey = null;
          if (pendingKeyTimer) {
            clearTimeout(pendingKeyTimer);
            pendingKeyTimer = null;
          }
        }
        if (isMicActive && isKeyActive) {
          stopRecording(true);
          isKeyActive = false;
        }
      }
    };

    const keyUpHandler = (e) => {
      const isCtrl = e.key === 'Control';
      const isAlt = e.key === 'Alt';
      if (isCtrl || isAlt) {
        if (pendingKey === e.key) {
          pendingKey = null;
          if (pendingKeyTimer) {
            clearTimeout(pendingKeyTimer);
            pendingKeyTimer = null;
          }
        }
        if (isKeyActive) {
          isKeyActive = false;
          if (isMicActive) {
            stopRecording(true);
          }
        }
      }
    };

    const blurHandler = () => {
      if (isMicActive) {
        stopRecording(true);
        isKeyActive = false;
        isButtonActive = false;
        pendingKey = null;
        if (pendingKeyTimer) {
          clearTimeout(pendingKeyTimer);
          pendingKeyTimer = null;
        }
      }
    };

    document.addEventListener('keydown', keyDownHandler);
    document.addEventListener('keyup', keyUpHandler);
    window.addEventListener('blur', blurHandler);

    const sendHandler = async () => {
      const state = getAppState();

      if (isMicActive) {
        stopRecording(true);
        isKeyActive = false;
        isButtonActive = false;
        await new Promise(r => setTimeout(r, 100));
      }

      if (state.get('sending')) return;

      const mode = state.get('currentMode');
      const content = newInput.value;
      if (!content.trim()) return;

      newInput.value = '';
      autoResize();
      if (newSendBtn) newSendBtn.disabled = true;

      try {
        if (mode === 'group') {
          const groupId = state.get('currentGroupId');
          if (groupId) {
            await import('./modules/groupChat.js').then(async m => {
              try {
                await m.sendUserGroupMessage(groupId, content);
                import('./ui/screens/groupChatUI.js').then(({ closeMentionPicker }) => {
                  closeMentionPicker();
                });
              } catch (err) {
                console.error('[Group] 发送失败:', err);
                showToast('发送失败: ' + err.message, 'error');
              }
            });
          } else {
            showToast('请先进入一个群组', 'warning');
          }
        } else {
          await import('./modules/chat.js').then(m => m.sendMessage(content));
        }
      } catch (err) {
        console.error('[Send] 发送失败:', err);
        showToast('发送失败: ' + err.message, 'error');
      } finally {
        if (newSendBtn) newSendBtn.disabled = false;
      }
    };

    newSendBtn.addEventListener('click', sendHandler);
    newInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendHandler();
      }
    });
  }

  const socialBtn = document.getElementById('socialBtn');
  if (socialBtn) {
    const newBtn = socialBtn.cloneNode(true);
    socialBtn.parentNode?.replaceChild(newBtn, socialBtn);
    newBtn.addEventListener('click', openSocialFeed);
  }

  const worldbookBtn = document.getElementById('worldbookBtn');
  if (worldbookBtn) {
    const newBtn = worldbookBtn.cloneNode(true);
    worldbookBtn.parentNode?.replaceChild(newBtn, worldbookBtn);
    newBtn.addEventListener('click', () => {
      import('./ui/screens/worldBookUI.js').then(({ renderWorldBookList }) => {
        renderWorldBookList();
      });
    });
  }

  const settingsBtn = document.getElementById('settingsBtn');
  if (settingsBtn) {
    const newBtn = settingsBtn.cloneNode(true);
    settingsBtn.parentNode?.replaceChild(newBtn, settingsBtn);
    newBtn.addEventListener('click', () => {
      const html = renderSettingsModal();
      openModal(html);
      const modalContent = document.querySelector('#modalContent');
      bindSettingsSave(modalContent);
    });
  }

  const importBtn = document.getElementById('importBtn');
  if (importBtn) {
    const newBtn = importBtn.cloneNode(true);
    importBtn.parentNode?.replaceChild(newBtn, importBtn);
    newBtn.addEventListener('click', renderImportModal);
  }

  const createBtn = document.getElementById('createBtn');
  if (createBtn) {
    const newBtn = createBtn.cloneNode(true);
    createBtn.parentNode?.replaceChild(newBtn, createBtn);
    newBtn.addEventListener('click', () => renderCharacterForm(null));
  }
}

function handleResize() {
  const state = getAppState();
  const isMobile = window.innerWidth < 768;
  state.set('isMobile', isMobile);
  const sidebar = document.getElementById('sidebar');
  const overlay = document.getElementById('sidebarOverlay');
  if (!isMobile && sidebar && overlay) {
    sidebar.classList.remove('open');
    overlay.classList.remove('show');
  }
}

let _groupMsgRenderTimer = null;

async function init() {
  checkAppVersion();

  const dbStatus = await checkDatabase();
  if (!dbStatus.ok) {
    showDbErrorDialog(dbStatus.error, dbStatus.code);
    return;
  }

  if (typeof window !== 'undefined') {
    window.__eventBus = globalEventBus;
  }

  initTheme();
  bindThemeToggle();

  setChatContainer(document.getElementById('chatMessages'));

  const settings = await loadSettings();
  if (settings.injectorRules && settings.injectorRules.length) {
    updateInjectorRules(settings.injectorRules);
  }

  await loadCharacters();

  try {
    const { normalizeAllConversations, normalizeAllGroups } = await import('./modules/conversationState.js');

    const convResult = await normalizeAllConversations();
    if (convResult.updated > 0) {
      console.log(`[App] 已规范化 ${convResult.updated}/${convResult.scanned} 个单聊会话的 convState`);
    } else {
      console.log(`[App] ${convResult.scanned} 个单聊会话的 convState 均无需更新`);
    }

    const groupResult = await normalizeAllGroups();
    if (groupResult.updated > 0) {
      console.log(`[App] 已规范化 ${groupResult.updated}/${groupResult.scanned} 个群聊（含 summary/lastSummaryIndex 字段补齐）`);
    } else {
      console.log(`[App] ${groupResult.scanned} 个群聊的字段与 convState 均无需更新`);
    }
  } catch (err) {
    console.warn('[App] 规范化会话状态失败:', err);
  }

  renderCharacterList();
  const { renderGroupList } = await import('./ui/screens/groupListUI.js');
  await renderGroupList();

  initCharacterListSubscription();

  try {
    const { startProactiveChat, stopProactiveChat } = await import('./modules/proactiveChat.js');
    _stopProactiveChat = stopProactiveChat;
    startProactiveChat();
    console.log('[App] 主动对话引擎已启动');
  } catch (err) {
    console.warn('[App] 主动对话引擎启动失败:', err);
  }

  try {
    const { hangupCurrentCall, hangupCurrentCallSync } = await import('./ui/screens/voiceCallUI.js');
    // 保留异步挂断引用供未来扩展（如插件系统、路由钩子等）
    _hangupCurrentCall = hangupCurrentCall;
    // 同步挂断引用用于 beforeunload（见下方 window.addEventListener）
    _hangupCurrentCallSync = hangupCurrentCallSync;
    if (typeof window !== 'undefined') {
      window.__utopiaHangupCall = hangupCurrentCall;          // 异步版本（落库后返回）
      window.__utopiaHangupCallSync = hangupCurrentCallSync;  // 同步版本（不等待落库）
    }
  } catch (err) {
    console.warn('[App] 加载 voiceCallUI 失败:', err);
  }

  window.addEventListener('beforeunload', () => {
    try {
      flushTimeToDB().catch(() => {});
    } catch (_) {}

    try { _stopProactiveChat?.(); } catch (_) {}

    try { _hangupCurrentCallSync?.(); } catch (_) {}

    clearAllIntervals();
  });

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      flushTimeToDB().catch(() => {});
    }
  });

  globalEventBus.on('group:created', async () => {
    const { renderGroupList } = await import('./ui/screens/groupListUI.js');
    await renderGroupList();
  });

  globalEventBus.on('group:message', ({ groupId }) => {
    const state = getAppState();
    const currentGroupId = state.get('currentGroupId');
    if (currentGroupId !== groupId) return;

    const MAX_RETRIES = 60;
    let retryCount = 0;

    const scheduleRender = () => {
      if (_groupMsgRenderTimer) clearTimeout(_groupMsgRenderTimer);
      _groupMsgRenderTimer = setTimeout(async () => {
        _groupMsgRenderTimer = null;
        try {
          const { renderMessages, isGroupStreaming, clearAllStreamingMarks } =
            await import('./ui/screens/groupChatUI.js');

          if (isGroupStreaming()) {
            retryCount++;
            if (retryCount >= MAX_RETRIES) {
              console.warn('[App] 群聊流式持续超时，放弃本次渲染（等待下次事件触发）');
              try {
                clearAllStreamingMarks();
              } catch (err) {
                console.warn('[App] 清空流式标记失败:', err);
              }
              return;
            }
            if (window.__DEBUG__) {
              console.log(`[App] 群聊正在流式，延迟渲染 (${retryCount}/${MAX_RETRIES})`);
            }
            scheduleRender();
            return;
          }
          await renderMessages(groupId);
        } catch (e) {
          console.warn('[App] 群消息渲染失败:', e);
        }
      }, 100);
    };

    scheduleRender();
  });

  try {
    const { renderCreateGroupButton } = await import('./ui/screens/groupListUI.js');
    renderCreateGroupButton();
  } catch (e) {
    console.warn('[App] 群组按钮加载失败:', e);
  }

  await initTime();
  await syncTime();
  await syncAllCharactersState();

  await recoverPendingCallEnd();

  setupWorldBookVectorSync();

  await initMemoryIndex();

  try {
    const { initPluginSystem, attachGlobalDebugApi } = await import('./plugins/pluginManager.js');
    await initPluginSystem();
    attachGlobalDebugApi();

    const { UtopiaApi } = await import('./plugins/pluginApi.js');
    if (typeof window !== 'undefined') {
      window.__utopiaApi = UtopiaApi;
    }

    console.log('[App] 插件系统已就绪');
  } catch (err) {
    console.warn('[App] 插件系统初始化失败:', err);
  }

  globalEventBus.emit('app:started', {
    version: '3.2',
    timestamp: Date.now(),
    settings,
  });

  const state = getAppState();
  const lastMode = localStorage.getItem('lastMode');
  let targetId = null;
  let targetMode = 'chat';

  if (lastMode === 'group') {
    const lastGroupId = localStorage.getItem('lastGroupId');
    if (lastGroupId) {
      try {
        const { getGroup } = await import('./modules/groupChat.js');
        const group = await getGroup(lastGroupId);
        if (group && group.status === 'active') {
          targetId = lastGroupId;
          targetMode = 'group';
        }
      } catch (e) {
        console.warn('[Init] 恢复群组失败:', e);
      }
    }
  }

  if (!targetId) {
    const savedCharId = localStorage.getItem('lastCharacterId');
    const chars = state.get('characters');
    if (savedCharId && chars.find(c => c.id === savedCharId)) {
      targetId = savedCharId;
      targetMode = 'chat';
    } else if (chars.length > 0) {
      targetId = chars[0].id;
      targetMode = 'chat';
    } else {
      try {
        const { getGroupsByUser } = await import('./modules/groupChat.js');
        const groups = await getGroupsByUser('user');
        if (groups.length > 0) {
          targetId = groups[0].id;
          targetMode = 'group';
        }
      } catch (e) {}
    }
  }

  if (targetId) {
    if (targetMode === 'chat') {
      state.set('currentCharacterId', targetId);
      state.set('currentMode', 'chat');
      state.set('currentGroupId', null);
    } else {
      state.set('currentGroupId', targetId);
      state.set('currentMode', 'group');
      state.set('currentCharacterId', null);
      const { openGroupChat } = await import('./ui/screens/groupChatUI.js');
      openGroupChat(targetId);
    }
  }

  state.subscribe('currentCharacterId', async (newId) => {
    import('./ui/screens/groupListUI.js').then(m => {
      if (m.updateGroupHighlight) m.updateGroupHighlight(null);
    });

    updateCharacterHighlight(newId);
    updateHeader();
    updateMainView();

    if (newId) {
      localStorage.setItem('lastMode', 'chat');
      localStorage.setItem('lastCharacterId', newId);
    }
  });

  state.subscribe('currentGroupId', async (newId) => {
    updateCharacterHighlight(null);
    import('./ui/screens/groupListUI.js').then(m => {
      if (m.updateGroupHighlight) m.updateGroupHighlight(newId);
    });
    updateHeader();
    updateMainView();

    if (newId) {
      localStorage.setItem('lastMode', 'group');
      localStorage.setItem('lastGroupId', newId);
    }
  });

  state.subscribe('groups', () => {
    updateMainView();
  });

  updateHeader();
  updateMainView();

  bindUIEvents();
  initSidebar();

  window.addEventListener('resize', handleResize);
  handleResize();

  registerInterval(() => {
    const currentChar = getCurrentCharacter();
    if (currentChar) {
      syncCharacterState(currentChar.id).catch(err => console.warn('[Timer] 状态同步失败:', err));
    }
  }, 60000);

  registerInterval(() => {
    checkAutoPost().catch(err => console.warn('[Social] 自动发帖失败:', err));
  }, 600000);

  registerInterval(() => {
    const groupId = state.get('currentGroupId');
    if (groupId) {
      import('./modules/groupChatEngine.js').then(m => {
        m.runAutoSpeakCycle(groupId).catch(err => console.warn('[Group] 自主发言轮询失败:', err));
      });
    }
  }, 300000);

  if (localStorage.getItem('utopia:dev-monitor') === 'on') {
    import('./dev/engineMonitor.js')
      .then(m => m.default.start())
      .catch(err => console.warn('[App] 加载 Engine Monitor 失败:', err));
  }
  console.log('✅ Utopia 应用已启动');
}

init().catch(err => {
  console.error('❌ 启动失败:', err);
  showToast('应用启动失败，请刷新重试', 'error');
});