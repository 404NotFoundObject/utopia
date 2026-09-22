// js/utils/messageSpeech.js
// 消息朗读公共模块：把 chatUI / groupChatUI 中高度重复的 TTS 朗读逻辑统一抽离。
//
// 使用方式：
//   const handler = createMessageSpeechHandler({
//     messageSelector: '.message',
//     bubbleSelector: '.bubble',
//     stateKey: '_speakingMsgId',
//     getContainer: () => container,
//     resolveCharacter: (msg, character) => Character | null,
//     logPrefix: '[TTS]',
//   });
//   await handler.speak(msg, character);
//   handler.updateButtonState(msgId, isPlaying);

import { speak as speakTTS, stop as stopTTS, isSpeaking } from '../services/ttsService.js';
import { showToast } from '../ui/components/toast.js';
import { getCleanContentFromElement, extractDialogueText } from './messageUtils.js';

export function createMessageSpeechHandler(config) {
  const {
    messageSelector,
    bubbleSelector,
    stateKey,
    getContainer,
    resolveCharacter,
    logPrefix = '[TTS]',
  } = config || {};

  if (!messageSelector || typeof messageSelector !== 'string') {
    throw new Error('createMessageSpeechHandler: messageSelector 必须是非空字符串');
  }
  if (!bubbleSelector || typeof bubbleSelector !== 'string') {
    throw new Error('createMessageSpeechHandler: bubbleSelector 必须是非空字符串');
  }
  if (!stateKey || typeof stateKey !== 'string') {
    throw new Error('createMessageSpeechHandler: stateKey 必须是非空字符串');
  }
  if (typeof getContainer !== 'function') {
    throw new Error('createMessageSpeechHandler: getContainer 必须是函数');
  }

  function updateButtonState(msgId, isPlaying) {
    const container = getContainer();
    if (!container) return;
    const el = container.querySelector(`${messageSelector}[data-id="${msgId}"]`);
    if (!el) return;
    const btn = el.querySelector('.speak-btn');
    if (!btn) return;

    if (isPlaying) {
      btn.innerHTML = '<i class="fas fa-stop"></i>';
      btn.title = '停止朗读';
      btn.classList.add('speaking');
      btn.style.color = 'var(--color-danger)';
      btn.style.opacity = '1';
    } else {
      btn.innerHTML = '<i class="fas fa-volume-up"></i>';
      btn.title = '朗读此消息';
      btn.classList.remove('speaking');
      btn.style.color = 'var(--color-text-muted)';
      btn.style.opacity = '0.5';
    }
  }

  async function speak(msg, character) {
    if (!msg) return;

    let content = msg.content || '';

    // 从 DOM 提取最新文本（覆盖 msg.content 滞后于流式内容的场景）
    const container = getContainer();
    if (msg.id && container) {
      const el = container.querySelector(`${messageSelector}[data-id="${msg.id}"]`);
      if (el) {
        const cleanText = getCleanContentFromElement(el, bubbleSelector);
        if (cleanText.length > content.length) {
          content = cleanText;
        }
      }
    }

    if (!content || content.trim().length === 0) {
      showToast('没有可朗读的内容', 'warning');
      return;
    }

    const dialogueText = extractDialogueText(content);
    if (!dialogueText || dialogueText.length === 0) {
      showToast('💭 该消息只有心理活动或动作描写，无需朗读', 'info');
      return;
    }

    // 再次点击同一条消息：停止朗读
    if (window[stateKey] === msg.id && isSpeaking()) {
      stopTTS();
      window[stateKey] = null;
      updateButtonState(msg.id, false);
      return;
    }

    // 有其他消息正在朗读：先停止
    if (isSpeaking()) {
      stopTTS();
      if (window[stateKey]) {
        updateButtonState(window[stateKey], false);
      }
    }

    window[stateKey] = msg.id;
    updateButtonState(msg.id, true);

    let targetChar = character;
    if (typeof resolveCharacter === 'function') {
      try {
        targetChar = resolveCharacter(msg, character);
      } catch (err) {
        console.warn(`${logPrefix} resolveCharacter 失败:`, err);
      }
    }

    try {
      await speakTTS(dialogueText, targetChar, {
        onEnd: function () {
          window[stateKey] = null;
          updateButtonState(msg.id, false);
        },
        onError: function (err) {
          console.warn(`${logPrefix} 朗读失败:`, err);
          window[stateKey] = null;
          updateButtonState(msg.id, false);
          showToast('朗读失败: ' + err.message, 'error');
        },
      });
    } catch (err) {
      window[stateKey] = null;
      updateButtonState(msg.id, false);
      showToast('朗读失败: ' + err.message, 'error');
    }
  }

  return { speak, updateButtonState };
}