// js/ui/screens/voiceCallUI.js
import { getAppState } from '../../core/state.js';
import { getStores } from '../../core/db.js';
import { generateUUID } from '../../core/utils.js';
import { escapeHtml } from '../../core/utils.js';
import { addMessageToConversation, ensureConversation } from '../../modules/conversation.js';
import { updateCharacter } from '../../modules/character.js';
import { generateProactiveMessage, buildPersonaBrief } from '../../modules/proactiveChat.js';
import { sendChatRequest } from '../../core/api.js';
import { buildEmotionPrompt } from '../../modules/emotionEngine.js';
import { buildBodyPrompt } from '../../modules/bodyState.js';
import { getTimeContext, getGameTime } from '../../modules/time.js';
import { showToast } from '../components/toast.js';
import { speak, stop as stopTTS, isSpeaking } from '../../services/ttsService.js';
import { startListening, stopListening, getFinalTranscript, resetTranscript, isCurrentlyListening } from '../../services/sttService.js';
import globalEventBus from '../../core/eventBus.js';

import { applyInjection } from '../../modules/injector.js';
import {
  fitContextByBudget,
  systemMsg,
  PRIORITY,
  computeBudget,
  getWorldBookBudgetRatio,
} from '../../modules/tokenBudget.js';

let currentCall = null;
let timerInterval = null;
let floatingBall = null;
let callTimeoutId = null;

const CALL_STATE = {
  IDLE: 'idle',
  INCOMING: 'incoming',
  CONNECTING: 'connecting',
  SPEAKING: 'speaking',
  LISTENING: 'listening',
  PROCESSING: 'processing',
  ENDED: 'ended',
};

const PENDING_CALL_END_KEY = 'utopia:pending-call-end';

const CALL_HISTORY_LIMIT = 20;
function isCallAlive(call) {
  return !!call && call.isActive === true && call.shouldContinue === true;
}

function injectCallStyles() {
  if (document.getElementById('voiceCallStyles')) return;
  const style = document.createElement('style');
  style.id = 'voiceCallStyles';
  style.textContent = `
    @keyframes pulse-ring {
      0% { transform: translate(-50%, -50%) scale(1); opacity: 0.7; }
      100% { transform: translate(-50%, -50%) scale(1.9); opacity: 0; }
    }
    .pulse-ring {
      position: absolute; top: 50%; left: 50%; width: 100%; height: 100%;
      border-radius: 50%; border: 2px solid rgba(255,255,255,0.25);
      transform: translate(-50%, -50%) scale(1);
      animation: pulse-ring 1.8s ease-out infinite;
      pointer-events: none; will-change: transform, opacity;
    }
    .pulse-ring:nth-child(2) { animation-delay: 0.6s; }
    .pulse-ring:nth-child(3) { animation-delay: 1.2s; }

    .avatar-wrapper {
      position: relative; width: 90px; height: 90px;
      margin-bottom: 16px; flex-shrink: 0;
    }
    .avatar-wrapper img {
      width: 100%; height: 100%; border-radius: 50%; object-fit: cover;
      border: 3px solid rgba(255,255,255,0.15);
      box-shadow: 0 8px 32px rgba(0,0,0,0.4);
      position: relative; z-index: 2;
    }

    @keyframes ripple-effect {
      0% { transform: scale(0); opacity: 0.8; }
      100% { transform: scale(4); opacity: 0; }
    }
    .ripple {
      position: absolute; border-radius: 50%;
      background: rgba(255,255,255,0.35);
      width: 20px; height: 20px; transform: scale(0);
      animation: ripple-effect 0.6s ease-out forwards;
      pointer-events: none;
    }
    .call-btn-wrapper {
      position: relative; display: inline-flex;
      align-items: center; justify-content: center;
    }
    .call-btn-wrapper button { position: relative; z-index: 2; }

    #callSubtitle {
      width: 100%; max-height: 100px; overflow-y: auto;
      margin: 8px 0; padding: 6px 10px;
      background: rgba(255,255,255,0.05);
      border-radius: 8px; font-size: 14px;
      color: rgba(255,255,255,0.8); text-align: left;
      scrollbar-width: thin;
      scrollbar-color: rgba(255,255,255,0.2) transparent;
      min-height: 30px;
      border: 1px solid rgba(255,255,255,0.05);
    }
    #callSubtitle::-webkit-scrollbar { width: 3px; }
    #callSubtitle::-webkit-scrollbar-thumb {
      background: rgba(255,255,255,0.2); border-radius: 10px;
    }

    .call-status-indicator {
      display: inline-block; width: 8px; height: 8px;
      border-radius: 50%; margin-right: 6px;
    }
    .call-status-indicator.listening { background: #2ecc71; animation: pulse-dot 1s ease-in-out infinite; }
    .call-status-indicator.speaking { background: #3498db; animation: pulse-dot 1.2s ease-in-out infinite; }
    .call-status-indicator.processing { background: #f39c12; animation: pulse-dot 0.6s ease-in-out infinite; }
    .call-status-indicator.idle { background: #95a5a6; }
    @keyframes pulse-dot {
      0%, 100% { opacity: 1; transform: scale(1); }
      50% { opacity: 0.3; transform: scale(0.7); }
    }

    #callFloatingBall { transition: box-shadow 0.2s, transform 0.15s; }
    #callFloatingBall:hover { transform: scale(1.05); }
    #callFloatingBall:active { transform: scale(0.92); }
  `;
  document.head.appendChild(style);
}

class CallState {
  constructor(character, proactive = true) {
    this.character = character;
    this.proactive = proactive;
    this.startTime = Date.now();
    this.state = CALL_STATE.IDLE;
    this.isActive = false;
    this.isMinimized = false;
    this.overlay = null;
    this.content = null;
    this.timerElement = null;
    this.speakerInterval = null;
    this.convId = null;
    this.messages = [];
    this.hasDragged = false;
    this.isDragging = false;
    this.ttsSpeaking = false;
    this.subtitleContainer = null;
    this.statusIndicator = null;
    this.isMuted = false;
    this.isProcessing = false;
    this.shouldContinue = true;
    this.userMessage = '';
    this.pendingUserMessage = '';
    this._lastProcessedText = '';
    this._subtitleItems = [];
    this._currentUserSubtitle = null;
    this.callTimedOut = false;
    this._sttStarting = false;
    this._sttStarted = false;
    this._displayedFinalUserMessages = [];
  }
}

function trimCallHistory(call) {
  if (!call || !Array.isArray(call.messages)) return;
  if (call.messages.length > CALL_HISTORY_LIMIT) {
    call.messages = call.messages.slice(-CALL_HISTORY_LIMIT);
  }
}

function extractDialogueText(text) {
  if (!text) return '';
  let cleaned = text;
  cleaned = cleaned.replace(/（[^）]*）/g, '');
  cleaned = cleaned.replace(/\([^)]*\)/g, '');
  cleaned = cleaned.replace(/\*[^*]*\*/g, '');
  cleaned = cleaned.replace(/_[^_]*_/g, '');
  cleaned = cleaned.replace(/【[^】]*】/g, '');
  cleaned = cleaned.replace(/\[[^\]]*\]/g, '');
  cleaned = cleaned.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');
  cleaned = cleaned.replace(/\s+/g, ' ').trim();
  return cleaned;
}

function updateCallStatus(call, state, statusText) {
  call.state = state;
  const indicator = call.statusIndicator;
  if (!indicator) return;
  indicator.className = 'call-status-indicator';
  const textEl = indicator.nextElementSibling;
  const label = statusText || {
    [CALL_STATE.LISTENING]: '🎤 正在听...',
    [CALL_STATE.SPEAKING]: '🔊 说话中...',
    [CALL_STATE.PROCESSING]: '💭 思考中...',
    [CALL_STATE.IDLE]: '⏸️ 等待中...',
  }[state] || '';
  switch (state) {
    case CALL_STATE.LISTENING: indicator.classList.add('listening'); break;
    case CALL_STATE.SPEAKING: indicator.classList.add('speaking'); break;
    case CALL_STATE.PROCESSING: indicator.classList.add('processing'); break;
    default: indicator.classList.add('idle');
  }
  if (textEl) textEl.textContent = label;
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function insertSystemMessageAndRefresh(character, content) {
  if (!character) return false;

  const conv = await ensureConversation(character.id, { silent: true });
  if (!conv) return false;

  const msg = {
    id: generateUUID(),
    role: 'system',
    content: content,
    timestamp: getGameTime(),
    isProactive: true,
    isVoice: true,
  };
  await addMessageToConversation(conv.id, msg);

  const state = getAppState();
  const currentCharId = state.get('currentCharacterId');
  const currentConvId = state.get('currentConversationId');
  const currentMode = state.get('currentMode');

  if (currentCharId === character.id
      && currentConvId === conv.id
      && currentMode === 'chat') {
    try {
      const { renderConversation } = await import('../../modules/chat.js');
      await renderConversation(conv.id);
    } catch (e) {
      console.warn('[通话] 刷新聊天界面失败:', e);
    }
  }

  return true;
}

function createIncomingModal(call) {
  injectCallStyles();
  const char = call.character;
  const overlay = document.createElement('div');
  overlay.className = 'voice-call-overlay';
  overlay.style.cssText = `
    position: fixed; inset: 0;
    background: rgba(0,0,0,0.75);
    backdrop-filter: blur(12px);
    -webkit-backdrop-filter: blur(12px);
    display: flex; align-items: center; justify-content: center;
    z-index: 1000;
  `;
  overlay.id = 'voiceCallOverlay';

  const container = document.createElement('div');
  container.style.cssText = `
    width: 360px; max-width: 90vw;
    aspect-ratio: 9 / 16;
    background: linear-gradient(160deg, #1a1a2e 0%, #0f0f1a 100%);
    border-radius: 40px;
    box-shadow: 0 24px 80px rgba(0,0,0,0.9);
    padding: 20px 24px 40px 24px;
    display: flex; flex-direction: column;
    align-items: center; justify-content: space-between;
    position: relative; color: #fff; text-align: center;
    border: 1px solid rgba(255,255,255,0.06);
  `;
  container.id = 'voiceCallContainer';

  const topSection = document.createElement('div');
  topSection.style.cssText = `display:flex;flex-direction:column;align-items:center;padding-top:16px;width:100%;`;
  topSection.id = 'callTopSection';

  const avatarWrapper = document.createElement('div');
  avatarWrapper.className = 'avatar-wrapper';
  for (let i = 0; i < 3; i++) {
    const ring = document.createElement('div');
    ring.className = 'pulse-ring';
    ring.style.animationDelay = (i * 0.6) + 's';
    avatarWrapper.appendChild(ring);
  }
  const avatarUrl = char.avatar || 'data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' width=\'120\' height=\'120\' viewBox=\'0 0 120 120\'%3E%3Ccircle cx=\'60\' cy=\'60\' r=\'60\' fill=\'%23333\'/%3E%3Ctext x=\'60\' y=\'72\' text-anchor=\'middle\' fill=\'%23999\' font-size=\'48\' font-family=\'sans-serif\'%3E?%3C/text%3E%3C/svg%3E';
  const avatarImg = document.createElement('img');
  avatarImg.src = avatarUrl;
  avatarImg.alt = char.name;
  avatarWrapper.appendChild(avatarImg);

  const nameEl = document.createElement('h2');
  nameEl.textContent = char.name;
  nameEl.style.cssText = `font-size:26px;font-weight:600;margin:0 0 6px 0;letter-spacing:0.5px;`;
  nameEl.id = 'callName';

  const statusEl = document.createElement('p');
  statusEl.textContent = '📞 来电呼叫';
  statusEl.style.cssText = `font-size:15px;color:rgba(255,255,255,0.5);margin:0;letter-spacing:0.3px;`;
  statusEl.id = 'callStatus';

  topSection.appendChild(avatarWrapper);
  topSection.appendChild(nameEl);
  topSection.appendChild(statusEl);

  const bottomSection = document.createElement('div');
  bottomSection.style.cssText = `display:flex;flex-direction:column;align-items:center;width:100%;padding-bottom:8px;`;
  bottomSection.id = 'callBottomSection';

  const btnContainer = document.createElement('div');
  btnContainer.style.cssText = `display:flex;gap:48px;justify-content:center;width:100%;`;
  btnContainer.id = 'callButtons';

  const rejectWrapper = document.createElement('div');
  rejectWrapper.className = 'call-btn-wrapper';
  const rejectBtn = document.createElement('button');
  rejectBtn.className = 'call-reject';
  rejectBtn.style.cssText = `width:68px;height:68px;border-radius:50%;background:#e74c3c;border:none;color:#fff;font-size:30px;display:flex;align-items:center;justify-content:center;cursor:pointer;box-shadow:0 4px 24px rgba(231,76,60,0.35);transition:transform 0.15s,box-shadow 0.15s;position:relative;z-index:2;`;
  rejectBtn.innerHTML = '<i class="fas fa-phone-slash"></i>';
  rejectBtn.addEventListener('mouseenter', () => { rejectBtn.style.transform = 'scale(1.06)'; rejectBtn.style.boxShadow = '0 6px 32px rgba(231,76,60,0.5)'; });
  rejectBtn.addEventListener('mouseleave', () => { rejectBtn.style.transform = 'scale(1)'; rejectBtn.style.boxShadow = '0 4px 24px rgba(231,76,60,0.35)'; });
  rejectBtn.addEventListener('click', (e) => { createRipple(e, rejectWrapper); rejectCall(call); });
  rejectWrapper.appendChild(rejectBtn);

  const acceptWrapper = document.createElement('div');
  acceptWrapper.className = 'call-btn-wrapper';
  const acceptBtn = document.createElement('button');
  acceptBtn.className = 'call-accept';
  acceptBtn.style.cssText = `width:68px;height:68px;border-radius:50%;background:#2ecc71;border:none;color:#fff;font-size:30px;display:flex;align-items:center;justify-content:center;cursor:pointer;box-shadow:0 4px 24px rgba(46,204,113,0.35);transition:transform 0.15s,box-shadow 0.15s;position:relative;z-index:2;`;
  acceptBtn.innerHTML = '<i class="fas fa-phone"></i>';
  acceptBtn.addEventListener('mouseenter', () => { acceptBtn.style.transform = 'scale(1.06)'; acceptBtn.style.boxShadow = '0 6px 32px rgba(46,204,113,0.5)'; });
  acceptBtn.addEventListener('mouseleave', () => { acceptBtn.style.transform = 'scale(1)'; acceptBtn.style.boxShadow = '0 4px 24px rgba(46,204,113,0.35)'; });
  acceptBtn.addEventListener('click', (e) => { createRipple(e, acceptWrapper); acceptCall(call); });
  acceptWrapper.appendChild(acceptBtn);

  btnContainer.appendChild(rejectWrapper);
  btnContainer.appendChild(acceptWrapper);
  bottomSection.appendChild(btnContainer);

  container.appendChild(topSection);
  container.appendChild(bottomSection);
  overlay.appendChild(container);
  document.body.appendChild(overlay);

  call.overlay = overlay;
  call.content = container;
  call._statusEl = statusEl;
  call._bottomSection = bottomSection;

  if (callTimeoutId) clearTimeout(callTimeoutId);
  callTimeoutId = setTimeout(async () => {
    if (!call.isActive) {
      call.callTimedOut = true;
      if (currentCall === call) {
        closeCall(call);
        await insertSystemMessageAndRefresh(
          call.character,
          '📵 ' + call.character.name + ' 的呼叫未接通（超时）'
        );
        showToast('呼叫超时，未接通', 'warning');
        globalEventBus.emit('voice:call-ended', { characterId: call.character.id, reason: 'timeout' });
      }
    }
    callTimeoutId = null;
  }, 30000);

  return overlay;
}

function createRipple(event, wrapper) {
  const rect = wrapper.getBoundingClientRect();
  const size = Math.max(rect.width, rect.height);
  const x = (event.clientX || event.pageX) - rect.left - size / 2;
  const y = (event.clientY || event.pageY) - rect.top - size / 2;
  const ripple = document.createElement('span');
  ripple.className = 'ripple';
  ripple.style.cssText = `
    position: absolute;
    top: ${y}px; left: ${x}px;
    width: ${size}px; height: ${size}px;
    border-radius: 50%;
    background: rgba(255,255,255,0.3);
    transform: scale(0);
    animation: ripple-effect 0.6s ease-out forwards;
    pointer-events: none;
    z-index: 1;
  `;
  wrapper.appendChild(ripple);
  setTimeout(() => ripple.remove(), 700);
}

async function acceptCall(call) {
  if (call.isActive) return;
  if (callTimeoutId) { clearTimeout(callTimeoutId); callTimeoutId = null; }
  call.isActive = true;
  call.shouldContinue = true;
  call.state = CALL_STATE.CONNECTING;

  const conv = await ensureConversation(call.character.id, { silent: true });
  call.convId = conv.id;

  const container = call.content;
  const bottomSection = call._bottomSection;
  bottomSection.innerHTML = '';

  const statusRow = document.createElement('div');
  statusRow.style.cssText = `display:flex;align-items:center;justify-content:center;gap:8px;margin:4px 0 8px 0;font-size:13px;color:rgba(255,255,255,0.6);`;
  const indicator = document.createElement('span');
  indicator.className = 'call-status-indicator idle';
  const statusText = document.createElement('span');
  statusText.textContent = '⏸️ 连接中...';
  statusRow.appendChild(indicator);
  statusRow.appendChild(statusText);
  call.statusIndicator = indicator;
  call._statusText = statusText;

  const subtitleContainer = document.createElement('div');
  subtitleContainer.id = 'callSubtitle';
  subtitleContainer.innerHTML = '<div style="color:rgba(255,255,255,0.3);text-align:center;font-size:13px;">等待开始对话...</div>';
  call.subtitleContainer = subtitleContainer;

  const hangupWrapper = document.createElement('div');
  hangupWrapper.className = 'call-btn-wrapper';
  const hangupBtn = document.createElement('button');
  hangupBtn.className = 'call-hangup';
  hangupBtn.style.cssText = `width:68px;height:68px;border-radius:50%;background:#e74c3c;border:none;color:#fff;font-size:30px;display:flex;align-items:center;justify-content:center;cursor:pointer;box-shadow:0 4px 24px rgba(231,76,60,0.35);transition:transform 0.15s,box-shadow 0.15s;position:relative;z-index:2;`;
  hangupBtn.innerHTML = '<i class="fas fa-phone-slash"></i>';
  hangupBtn.addEventListener('mouseenter', () => { hangupBtn.style.transform = 'scale(1.06)'; hangupBtn.style.boxShadow = '0 6px 32px rgba(231,76,60,0.5)'; });
  hangupBtn.addEventListener('mouseleave', () => { hangupBtn.style.transform = 'scale(1)'; hangupBtn.style.boxShadow = '0 4px 24px rgba(231,76,60,0.35)'; });
  hangupBtn.addEventListener('click', (e) => { createRipple(e, hangupWrapper); hangupCall(call); });
  hangupWrapper.appendChild(hangupBtn);

  bottomSection.appendChild(statusRow);
  bottomSection.appendChild(subtitleContainer);
  bottomSection.appendChild(hangupWrapper);

  const statusEl = call._statusEl;
  if (statusEl) {
    statusEl.textContent = '⏱ 00:00';
    statusEl.style.color = 'rgba(255,255,255,0.7)';
    statusEl.style.fontSize = '18px';
    statusEl.id = 'callTimer';
    call.timerElement = statusEl;
  }

  const minimizeBtn = document.createElement('button');
  minimizeBtn.className = 'call-minimize';
  minimizeBtn.style.cssText = `position:absolute;top:16px;right:16px;background:rgba(255,255,255,0.08);border:none;color:rgba(255,255,255,0.6);font-size:18px;width:34px;height:34px;border-radius:50%;display:flex;align-items:center;justify-content:center;cursor:pointer;transition:background 0.2s;z-index:10;`;
  minimizeBtn.innerHTML = '<i class="fas fa-window-minimize"></i>';
  minimizeBtn.addEventListener('mouseenter', () => minimizeBtn.style.background = 'rgba(255,255,255,0.16)');
  minimizeBtn.addEventListener('mouseleave', () => minimizeBtn.style.background = 'rgba(255,255,255,0.08)');
  minimizeBtn.addEventListener('click', () => minimizeCall(call));
  container.appendChild(minimizeBtn);

  startTimer(call);

  updateCallStatus(call, CALL_STATE.SPEAKING, '🔊 角色说话中...');
  await addSubtitle(call, 'system', '通话已接通，角色即将说话...');
  await sleep(500);
  await speakInCall(call, true);

  setTimeout(() => {
    if (call.isActive && call.shouldContinue) {
      startListeningLoop(call);
    }
  }, 1000);
}

async function startListeningLoop(call) {
  if (!call.isActive || !call.shouldContinue) {
    console.log('[通话] 通话已结束，停止监听循环');
    return;
  }
  if (call.state === CALL_STATE.PROCESSING) {
    console.log('[通话] 正在处理中，不启动 STT');
    return;
  }
  if (call.state === CALL_STATE.SPEAKING) {
    console.log('[通话] 正在说话中，不启动 STT');
    return;
  }
  if (call.state !== CALL_STATE.LISTENING) {
    console.log('[通话] 状态不是 LISTENING，强制切换为 LISTENING');
    updateCallStatus(call, CALL_STATE.LISTENING, '🎤 请说话...');
  }
  if (call._sttStarting) {
    console.log('[通话] STT 正在启动中，跳过');
    return;
  }
  if (isCurrentlyListening()) {
    console.log('[通话] STT 已经在监听中');
    return;
  }

  call._sttStarting = true;
  stopListening(false);
  resetTranscript();

  call.userMessage = '';
  call.pendingUserMessage = '';
  call._lastProcessedText = '';
  call._displayedFinalUserMessages = [];

  clearUserSubtitles(call);
  await addSubtitle(call, 'system', '🎤 正在听你说话...');

  try {
    await startListening({
      language: 'zh-CN',
      continuous: true,
      autoRestart: false,
      onResult: (text, isFinal) => {
        if (!call.isActive || !call.shouldContinue) return;
        handleSTTResult(call, text, isFinal);
      },
      onEnd: () => {
        console.log('[通话] STT 自然结束');
        call._sttStarting = false;
        if (call.isActive && call.shouldContinue && !call.isProcessing) {
          if (call.state === CALL_STATE.LISTENING) {
            setTimeout(() => {
              startListeningLoop(call);
            }, 300);
          }
        }
      },
      onError: (error) => {
        console.warn('[通话] STT 错误:', error);
        call._sttStarting = false;
        if (error === 'no-speech') {
          setTimeout(() => startListeningLoop(call), 500);
          return;
        }
        if (error === 'not-allowed') {
          showToast('麦克风权限被拒绝，请允许后重试', 'error');
          return;
        }
        if (call.isActive && call.shouldContinue && !call.isProcessing) {
          setTimeout(() => {
            if (call.state === CALL_STATE.LISTENING) {
              startListeningLoop(call);
            }
          }, 1500);
        }
      },
    });
    call._sttStarting = false;
    call._sttStarted = true;
    console.log('[通话] STT 启动成功');
  } catch (err) {
    console.error('[通话] STT 启动失败:', err);
    call._sttStarting = false;
    if (call.isActive && call.shouldContinue && !call.isProcessing) {
      setTimeout(() => {
        if (call.state === CALL_STATE.LISTENING) {
          startListeningLoop(call);
        }
      }, 2000);
    }
  }
}

function handleSTTResult(call, text, isFinal) {
  if (!text || !text.trim()) return;

  if (isFinal) {
    const trimmed = text.trim();
    if (call._displayedFinalUserMessages && call._displayedFinalUserMessages.includes(trimmed)) {
      console.log('[通话] 重复最终结果，忽略:', trimmed);
      return;
    }
    updateUserSubtitle(call, trimmed, true);
    if (!call._displayedFinalUserMessages) call._displayedFinalUserMessages = [];
    call._displayedFinalUserMessages.push(trimmed);

    if (trimmed === call._lastProcessedText) {
      return;
    }
    call._lastProcessedText = trimmed;
    call.userMessage = trimmed;

    if (call.userMessage.length > 0 && !call.isProcessing) {
      stopListening(true);
      call._sttStarted = false;
      processUserMessage(call);
    }
  } else {
    updateUserSubtitle(call, text, false);
  }
}

async function processUserMessage(call) {
  if (call.isProcessing) return;
  if (!call.userMessage || call.userMessage.length === 0) {
    if (call.isActive && call.shouldContinue) {
      await sleep(500);
      startListeningLoop(call);
    }
    return;
  }

  call.isProcessing = true;
  updateCallStatus(call, CALL_STATE.PROCESSING, '💭 思考中...');

  try {
    await addSubtitle(call, 'user', call.userMessage);

    const character = call.character;
    const convId = call.convId;
    const state = getAppState();
    const settings = state.get('settings') || {};

    const stores = await getStores();
    const conv = await stores.conversations.get(convId);

    const systemMessages = [];

    systemMessages.push(systemMsg(
      '【通话状态】你正在和用户进行语音通话。请像正常打电话一样说话，自然、流畅。注意：对方能听到你的声音，所以语气要真实，不要像在发文字消息。',
      'call_state',
      PRIORITY.IDENTITY
    ));

    const personaMsg = buildPersonaBrief(character);
    systemMessages.push(systemMsg(personaMsg, 'persona', PRIORITY.IDENTITY));

    const emotionPrompt = buildEmotionPrompt(character);
    if (emotionPrompt) {
      systemMessages.push(systemMsg(emotionPrompt, 'emotion', PRIORITY.EMOTION));
    }

    const bodyPrompt = buildBodyPrompt(character);
    if (bodyPrompt) {
      systemMessages.push(systemMsg(bodyPrompt, 'body', PRIORITY.BODY));
    }

    const timeCtx = getTimeContext();
    systemMessages.push(systemMsg(
      `【当前时间】${timeCtx.gameTime.natural}\n${timeCtx.gameTime.description}`,
      'time',
      PRIORITY.TIME
    ));

    const memoryContext = [];
    if (conv && conv.summary) {
      memoryContext.push(`【对话摘要】${conv.summary}`);
    }
    if (memoryContext.length > 0) {
      systemMessages.push(systemMsg(memoryContext.join('\n\n'), 'memory', PRIORITY.MEMORY));
    }

    const historyMessages = [];
    if (conv && conv.messages) {
      const history = conv.messages.slice(-10);
      for (const msg of history) {
        if (msg.role === 'user' || msg.role === 'assistant') {
          historyMessages.push({ role: msg.role, content: msg.content });
        }
      }
    }
    const callHistory = (call.messages || []).slice(-CALL_HISTORY_LIMIT);
    for (const msg of callHistory) {
      if (msg && msg.role && msg.content) {
        historyMessages.push({ role: msg.role, content: msg.content });
      }
    }

    const modelName = settings?.modelName;
    const tbEnabled = settings.tokenBudget?.enabled !== false;
    const wbBudgetRatio = getWorldBookBudgetRatio();

    let worldBookBudget;
    let systemBudgetOverride;
    {
      const rawBudget = computeBudget(modelName);
      const rawSystemBudget = rawBudget.breakdown.system;
      worldBookBudget = Math.floor(rawSystemBudget * wbBudgetRatio);
      systemBudgetOverride = tbEnabled ? rawSystemBudget - worldBookBudget : undefined;
    }

    const budgetResult = fitContextByBudget({
      modelName,
      systemMessages,
      historyMessages,
      userMessage: call.userMessage,
      summary: conv?.summary || '',
      systemBudgetOverride,
    });

    const messagesForAPI = [
      ...budgetResult.systemKept.map(m => ({ role: 'system', content: m.content })),
      ...budgetResult.historyKept,
      { role: 'user', content: call.userMessage },
    ];

    const context = {
      character,
      emotionState: character.emotionState,
      bodyState: character.bodyState,
      user: {
        ...(settings.user || { name: '用户' }),
        message: call.userMessage,
      },
      conversation: conv,
      ...timeCtx,
    };

    let finalMessages = [];
    let fullSystem = '';
    try {
      const result = await applyInjection(messagesForAPI, context, { worldBookBudget });
      fullSystem = result
        .filter(msg => msg.role === 'system')
        .map(msg => msg.content)
        .join('\n\n');
      finalMessages = result.filter(msg => msg.role !== 'system');
    } catch (e) {
      console.warn('[通话] 注入器执行失败，使用降级方案:', e);
      const degradedSystemMsgs = messagesForAPI
        .filter(msg => msg.role === 'system')
        .map(msg => msg.content)
        .filter(c => c && c.trim());
      fullSystem = [
        character.systemPrompt || '',
        ...degradedSystemMsgs,
      ].filter(Boolean).join('\n\n');
      finalMessages = messagesForAPI.filter(msg => msg.role !== 'system');
    }

    console.log(`\n%c📞 [语音通话] 注入内容 (角色: ${character.name})`, 'font-size:14px;font-weight:bold;color:#6c5ce7;');
    console.log('%c━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━', 'color:#6a6a8a;');

    const allForLog = [
      { role: 'system', content: fullSystem },
      ...finalMessages,
    ];
    allForLog.forEach((msg, idx) => {
      const roleColor = msg.role === 'system' ? '#f39c12' : msg.role === 'user' ? '#2ecc71' : '#3498db';
      const roleLabel = msg.role === 'system' ? '🟡 SYSTEM' : msg.role === 'user' ? '🟢 USER' : '🔵 ASSISTANT';
      const preview = msg.content.length > 200 ? msg.content.substring(0, 200) + '...' : msg.content;
      console.log(`%c[${idx + 1}] ${roleLabel}`, `color:${roleColor};font-weight:bold;`);
      console.log(`%c${preview}`, 'color:#e0e0e0;');
      if (msg.content.length > 200) {
        console.log(`%c... (共 ${msg.content.length} 字符)`, 'color:#6a6a8a;font-style:italic;');
      }
      console.log('');
    });
    console.log('%c━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━', 'color:#6a6a8a;');
    console.log(`📊 总计 ${allForLog.length} 条消息`);

    let response = await sendChatRequest({
      messages: finalMessages,
      systemPrompt: fullSystem,
      model: modelName,
      temperature: 0.85,
      maxTokens: 400,
      stream: false,
    });

    if (!isCallAlive(call)) {
      console.log('[通话] 通话已结束（LLM 返回后），丢弃本次 AI 回复');
      return;
    }

    let reply = response.content?.trim();

    if (!reply) {
      console.warn(`[通话] ${character.name} 首次生成空回复，尝试重试`);
      try {
        response = await sendChatRequest({
          messages: finalMessages,
          systemPrompt: fullSystem,
          model: modelName,
          temperature: 0.9,
          maxTokens: 400,
          stream: false,
        });

        if (!isCallAlive(call)) {
          console.log('[通话] 通话已结束（重试返回后），丢弃本次 AI 回复');
          return;
        }

        reply = response.content?.trim();
      } catch (e) {
        console.warn('[通话] 重试失败:', e);
      }
    }

    if (!reply) reply = '嗯...我不知道该说什么。';

    if (!isCallAlive(call)) {
      console.log('[通话] 通话已结束（构建 reply 后），放弃后续处理');
      return;
    }

    const chars = state.get('characters') || [];
    const latestChar = chars.find(c => c.id === character.id) || character;

    const dialogueText = extractDialogueText(reply);
    if (dialogueText && dialogueText.length > 0) {
      await addSubtitle(call, 'assistant', dialogueText);
      if (!isCallAlive(call)) {
        console.log('[通话] 通话已结束（TTS 播放前），跳过语音播放');
        return;
      }

      updateCallStatus(call, CALL_STATE.SPEAKING, '🔊 说话中...');

      call.messages.push({ role: 'user', content: call.userMessage });
      call.messages.push({ role: 'assistant', content: dialogueText });
      trimCallHistory(call);

      const autoSpeak = settings?.tts?.autoSpeak !== false;
      if (autoSpeak) {
        stopTTS();
        try {
          await speak(dialogueText, latestChar, {
            onStart: () => { call.ttsSpeaking = true; },
            onEnd: () => {
              call.ttsSpeaking = false;
              if (call.isActive && call.shouldContinue) {
                console.log('[通话] TTS 结束，进入监听状态');
                updateCallStatus(call, CALL_STATE.LISTENING, '🎤 请说话...');
                setTimeout(() => {
                  startListeningLoop(call);
                }, 300);
              }
            },
            onError: (err) => { call.ttsSpeaking = false; },
          });
        } catch (err) { call.ttsSpeaking = false; }
      } else {
        console.log('[语音] ' + latestChar.name + ' 说: ' + dialogueText);
        if (call.isActive && call.shouldContinue) {
          updateCallStatus(call, CALL_STATE.LISTENING, '🎤 请说话...');
          setTimeout(() => startListeningLoop(call), 300);
        }
      }
    }

    await updateCharacter(latestChar.id, {
      lastInteraction: { gameTime: getGameTime(), realTime: Date.now() },
      lastProactiveTime: getGameTime(),
    });

  } catch (err) {
    console.error('[通话] AI 回复失败:', err);
    try {
      await addSubtitle(call, 'system', '⚠️ 生成回复失败，请重试');
    } catch (_) {}
  } finally {
    call.isProcessing = false;
    call._lastProcessedText = '';
    call._displayedFinalUserMessages = [];

    if (call.isActive && call.shouldContinue) {
      call.userMessage = '';
      if (call.state !== CALL_STATE.LISTENING) {
        updateCallStatus(call, CALL_STATE.LISTENING, '🎤 请说话...');
      }
      setTimeout(() => startListeningLoop(call), 300);
    }
  }
}

async function addSubtitle(call, speaker, text) {
  const container = call.subtitleContainer;
  if (!container) return;
  if (speaker === 'system') {
    const div = document.createElement('div');
    div.style.cssText = 'color:rgba(255,255,255,0.4);font-style:italic;font-size:12px;padding:2px 0;';
    div.textContent = text;
    container.appendChild(div);
    container.scrollTop = container.scrollHeight;
    return;
  }
  const div = document.createElement('div');
  div.style.cssText = 'padding:3px 0;border-bottom:1px solid rgba(255,255,255,0.05);';
  const speakerColor = speaker === 'user' ? '#2ecc71' : '#3498db';
  const speakerLabelRaw = speaker === 'user' ? '👤 你' : call.character.name;
  const speakerLabel = escapeHtml(speakerLabelRaw);
  const safeText = escapeHtml(text);
  div.innerHTML = '<span style="color:' + speakerColor + ';font-weight:500;">' + speakerLabel + '</span><span style="color:rgba(255,255,255,0.8);margin-left:6px;">' + safeText + '</span>';
  container.appendChild(div);
  container.scrollTop = container.scrollHeight;
  return div;
}

function updateUserSubtitle(call, text, isFinal) {
  const container = call.subtitleContainer;
  if (!container) return;
  const oldUserDivs = container.querySelectorAll('.user-interim, .user-final');
  for (const div of oldUserDivs) div.remove();

  const div = document.createElement('div');
  div.className = isFinal ? 'user-final' : 'user-interim';
  div.style.cssText = 'padding:3px 0;border-bottom:1px solid rgba(255,255,255,0.05);';
  const color = isFinal ? '#2ecc71' : 'rgba(46,204,113,0.5)';
  const label = isFinal ? '👤 你' : '👤 你 (识别中...)';
  const safeText = escapeHtml(text);
  div.innerHTML = '<span style="color:' + color + ';font-weight:500;">' + label + '</span><span style="color:' + (isFinal ? 'rgba(255,255,255,0.9)' : 'rgba(255,255,255,0.5)') + ';margin-left:6px;">' + safeText + '</span>';
  container.appendChild(div);
  container.scrollTop = container.scrollHeight;
}

function clearUserSubtitles(call) {
  const container = call.subtitleContainer;
  if (!container) return;
  const userDivs = container.querySelectorAll('.user-interim, .user-final');
  for (const div of userDivs) div.remove();
  const sysDivs = container.querySelectorAll('[style*="color:rgba(255,255,255,0.4)"]');
  for (const div of sysDivs) {
    if (div.textContent.includes('正在听') || div.textContent.includes('等待')) div.remove();
  }
}

async function speakInCall(call, isFirst = false) {
  if (!call.isActive || !call.shouldContinue) return;

  const state = getAppState();
  const chars = state.get('characters') || [];
  const character = chars.find(c => c.id === call.character.id) || call.character;

  let content;
  if (isFirst) {
    content = await generateProactiveMessage(character);
  } else {
    content = await generateProactiveMessage(
      character,
      {},
      '你正在和用户进行语音通话，请说一句自然的话（10-30字），可以是对用户之前话题的回应，也可以是分享当前心情或想法。直接输出你的话。'
    );
  }

  if (!isCallAlive(call)) {
    console.log('[通话] 通话已结束（首轮发言 LLM 返回后），丢弃本次内容');
    return;
  }

  if (!content) return;

  const dialogueText = extractDialogueText(content);
  if (!dialogueText || dialogueText.length === 0) return;

  await addSubtitle(call, 'assistant', dialogueText);

  if (!isCallAlive(call)) {
    console.log('[通话] 通话已结束（TTS 播放前），跳过语音播放');
    return;
  }

  const settings = state.get('settings');
  const autoSpeak = settings?.tts?.autoSpeak !== false;
  if (autoSpeak) {
    stopTTS();
    call.ttsSpeaking = true;
    try {
      await speak(dialogueText, character, {
        onStart: () => { call.ttsSpeaking = true; },
        onEnd: () => {
          call.ttsSpeaking = false;
          if (call.isActive && call.shouldContinue) {
            console.log('[通话] 角色说话结束，进入监听状态');
            updateCallStatus(call, CALL_STATE.LISTENING, '🎤 请说话...');
            setTimeout(() => {
              if (call.isActive && call.shouldContinue) {
                startListeningLoop(call);
              }
            }, 300);
          }
        },
        onError: (err) => { call.ttsSpeaking = false; },
      });
    } catch (err) { call.ttsSpeaking = false; }
  } else {
    console.log('[语音] ' + character.name + ' 说: ' + dialogueText);
    if (call.isActive && call.shouldContinue) {
      updateCallStatus(call, CALL_STATE.LISTENING, '🎤 请说话...');
      setTimeout(() => startListeningLoop(call), 300);
    }
  }

  if (!isCallAlive(call)) return;

  call.messages.push({ role: 'assistant', content: dialogueText });
  trimCallHistory(call);
}

async function rejectCall(call) {
  if (call.isActive) return;
  if (callTimeoutId) { clearTimeout(callTimeoutId); callTimeoutId = null; }
  stopTTS();
  stopListening(false);
  call.shouldContinue = false;
  closeCall(call);
  await insertSystemMessageAndRefresh(
    call.character,
    '📵 ' + call.character.name + ' 的来电已被拒接'
  );
  await updateCharacter(call.character.id, { lastProactiveTime: getGameTime() });
  showToast('已拒接 ' + call.character.name + ' 的来电', 'info');
}

async function hangupCall(call) {
  if (!call.isActive) {
    closeCall(call);
    return;
  }

  if (callTimeoutId) { clearTimeout(callTimeoutId); callTimeoutId = null; }
  stopTTS();
  stopListening(false);
  call.shouldContinue = false;
  call.isActive = false;
  call.isProcessing = false;

  const elapsed = Math.floor((Date.now() - call.startTime) / 1000);
  const minutes = String(Math.floor(elapsed / 60)).padStart(2, '0');
  const seconds = String(elapsed % 60).padStart(2, '0');
  const durationStr = minutes + ':' + seconds;

  const nowReal = Date.now();
  const nowGame = getGameTime();
  try {
    localStorage.setItem(PENDING_CALL_END_KEY, JSON.stringify({
      characterId: call.character.id,
      duration: elapsed,
      endTime: nowReal,
      endGameTime: nowGame,
    }));
  } catch (_) {}

  let messageInserted = false;
  try {
    messageInserted = await insertSystemMessageAndRefresh(
      call.character,
      '📞 通话结束 (时长 ' + durationStr + ')'
    );
  } catch (e) {
    console.warn('[通话] 写入通话结束消息失败，保留 pending 供下次启动补偿:', e);
    messageInserted = false;
  }

  try {
    await updateCharacter(call.character.id, { inCall: false });
  } catch (e) {
    console.warn('[通话] 清除 inCall 状态失败:', e);
  }

  if (messageInserted) {
    try { localStorage.removeItem(PENDING_CALL_END_KEY); } catch (_) {}
  }

  if (call.speakerInterval) clearInterval(call.speakerInterval);
  closeCall(call);

  showToast('与 ' + call.character.name + ' 通话结束 (' + durationStr + ')', 'info');
  globalEventBus.emit('voice:call-ended', { characterId: call.character.id, duration: elapsed });
}

function minimizeCall(call) {
  if (call.isMinimized) return;
  call.isMinimized = true;
  call.overlay.style.display = 'none';
  createFloatingBall(call);
}

function expandCall(call) {
  if (!call.isMinimized) return;
  call.isMinimized = false;
  if (floatingBall) {
    if (floatingBall._cleanup) floatingBall._cleanup();
    floatingBall.remove();
    floatingBall = null;
  }
  call.overlay.style.display = 'flex';
  updateTimerDisplay(call);
}

function createFloatingBall(call) {
  if (floatingBall) {
    if (floatingBall._cleanup) floatingBall._cleanup();
    floatingBall.remove();
  }
  const ball = document.createElement('div');
  ball.id = 'callFloatingBall';
  ball.style.cssText = `position:fixed;width:64px;height:64px;border-radius:50%;background:var(--color-primary-gradient);color:#fff;display:flex;flex-direction:column;align-items:center;justify-content:center;cursor:grab;z-index:999;box-shadow:0 4px 20px rgba(108,92,231,0.45);font-size:0.75rem;font-weight:bold;user-select:none;touch-action:none;`;
  ball.innerHTML = '<i class="fas fa-phone" style="font-size:1.1rem;"></i><span class="floating-timer" style="font-size:0.65rem;margin-top:1px;">00:00</span>';
  document.body.appendChild(ball);
  floatingBall = ball;
  const initialX = window.innerWidth - 84;
  const initialY = window.innerHeight * 0.4;
  ball.style.left = initialX + 'px';
  ball.style.top = initialY + 'px';

  let dragOffsetX = 0, dragOffsetY = 0;
  const startDrag = (e) => {
    call.isDragging = true;
    call.hasDragged = false;
    ball.style.cursor = 'grabbing';
    ball.style.boxShadow = '0 8px 36px rgba(108,92,231,0.7)';
    const clientX = e.clientX || e.touches?.[0]?.clientX;
    const clientY = e.clientY || e.touches?.[0]?.clientY;
    if (clientX !== undefined && clientY !== undefined) {
      const rect = ball.getBoundingClientRect();
      dragOffsetX = clientX - rect.left;
      dragOffsetY = clientY - rect.top;
    }
    e.preventDefault?.();
  };
  const moveDrag = (e) => {
    if (!call.isDragging) return;
    const clientX = e.clientX || e.touches?.[0]?.clientX;
    const clientY = e.clientY || e.touches?.[0]?.clientY;
    if (clientX === undefined || clientY === undefined) return;
    const rect = ball.getBoundingClientRect();
    const dx = clientX - dragOffsetX - rect.left;
    const dy = clientY - dragOffsetY - rect.top;
    if (Math.abs(dx) > 5 || Math.abs(dy) > 5) call.hasDragged = true;
    let newX = clientX - dragOffsetX;
    let newY = clientY - dragOffsetY;
    const size = 64;
    newX = Math.max(0, Math.min(window.innerWidth - size, newX));
    newY = Math.max(0, Math.min(window.innerHeight - size, newY));
    ball.style.left = newX + 'px';
    ball.style.top = newY + 'px';
    e.preventDefault?.();
  };
  const endDrag = () => {
    if (call.isDragging) {
      call.isDragging = false;
      ball.style.cursor = 'grab';
      ball.style.boxShadow = '0 4px 20px rgba(108,92,231,0.45)';
      if (call.hasDragged) setTimeout(() => { call.hasDragged = false; }, 300);
    }
  };
  ball.addEventListener('mousedown', startDrag);
  document.addEventListener('mousemove', moveDrag);
  document.addEventListener('mouseup', endDrag);
  ball.addEventListener('touchstart', startDrag, { passive: false });
  document.addEventListener('touchmove', moveDrag, { passive: false });
  document.addEventListener('touchend', endDrag);

  let clickTimer = null;
  ball.addEventListener('click', () => {
    if (call.hasDragged) { call.hasDragged = false; return; }
    if (clickTimer) clearTimeout(clickTimer);
    clickTimer = setTimeout(() => { expandCall(call); }, 150);
  });
  ball._cleanup = () => {
    document.removeEventListener('mousemove', moveDrag);
    document.removeEventListener('mouseup', endDrag);
    document.removeEventListener('touchmove', moveDrag);
    document.removeEventListener('touchend', endDrag);
  };
}

function startTimer(call) {
  if (timerInterval) clearInterval(timerInterval);
  timerInterval = setInterval(() => {
    if (!call.isActive) { clearInterval(timerInterval); timerInterval = null; return; }
    updateTimerDisplay(call);
  }, 1000);
}

function updateTimerDisplay(call) {
  const elapsed = Math.floor((Date.now() - call.startTime) / 1000);
  const m = String(Math.floor(elapsed / 60)).padStart(2, '0');
  const s = String(elapsed % 60).padStart(2, '0');
  const timeStr = m + ':' + s;
  if (call.timerElement) call.timerElement.textContent = '⏱ ' + timeStr;
  if (floatingBall) {
    const timerSpan = floatingBall.querySelector('.floating-timer');
    if (timerSpan) timerSpan.textContent = timeStr;
  }
}

function closeCall(call) {
  if (callTimeoutId) { clearTimeout(callTimeoutId); callTimeoutId = null; }
  stopTTS();
  stopListening(false);
  call.shouldContinue = false;
  call.isActive = false;
  call.isProcessing = false;
  call.ttsSpeaking = false;
  call._sttStarting = false;
  call._sttStarted = false;
  call._displayedFinalUserMessages = [];
  if (call.speakerInterval) clearInterval(call.speakerInterval);
  if (call.overlay) call.overlay.remove();
  if (floatingBall) {
    if (floatingBall._cleanup) floatingBall._cleanup();
    floatingBall.remove();
    floatingBall = null;
  }
  if (timerInterval) { clearInterval(timerInterval); timerInterval = null; }
  if (currentCall === call) currentCall = null;
}

export async function startVoiceCall(character, options = { proactive: true }) {
  if (currentCall) {
    await hangupCall(currentCall);
  }
  const call = new CallState(character, options.proactive);
  currentCall = call;
  createIncomingModal(call);
  return call;
}

export async function hangupCurrentCall() {
  if (currentCall) {
    await hangupCall(currentCall);
  }
}

export function hangupCurrentCallSync() {
  if (!currentCall) return;
  const call = currentCall;

  if (!call.isActive) {
    try { closeCall(call); } catch (_) {}
    return;
  }

  const elapsed = Math.floor((Date.now() - call.startTime) / 1000);

  const nowReal = Date.now();
  const nowGame = getGameTime();

  try {
    localStorage.setItem(PENDING_CALL_END_KEY, JSON.stringify({
      characterId: call.character.id,
      duration: elapsed,
      endTime: nowReal,
      endGameTime: nowGame,
    }));
  } catch (_) {}

  try { closeCall(call); } catch (_) {}
}

export function getCallState() {
  return currentCall ? {
    active: currentCall.isActive,
    state: currentCall.state,
    character: currentCall.character?.name,
    duration: Math.floor((Date.now() - currentCall.startTime) / 1000),
  } : null;
}