// js/modules/chat.js - 单聊对话逻辑

import { getAppState } from '../core/state.js';
import { generateUUID } from '../core/utils.js';
import { sendChatRequest } from '../core/api.js';
import { getCurrentCharacter, syncCharacterState, updateCharacter } from './character.js';
import { applyInjection } from './injector.js';
import { showToast } from '../ui/components/toast.js';
import { getStores } from '../core/db.js';
import {
  addMessageToConversation,
  clearConversation,
  getCurrentConversation,
  loadConversations,
  removeMessageFromConversation,
  updateConversationSummary,
  updateConversationWithLock,
} from './conversation.js';
import { searchMemories, addMemory } from './memory.js';
import { syncTime, getTimeContext, getGameTime } from './time.js';
import { ensureFirstMessage } from './firstMessage.js';
import {
  classifyUserMessage,
  handleInteraction,
  buildEmotionPrompt,
} from './emotionEngine.js';
import {
  tryWakeUp,
  getSleepRefusalMessage,
  handleBodyEvent,
  buildBodyPrompt,
} from './bodyState.js';
import * as chatUI from '../ui/screens/chatUI.js';
import { shouldGenerateSummary, getMessagesToSummarize, formatMessagesForSummary, generateSummary } from './summary.js';
import globalEventBus from '../core/eventBus.js';

import { analyzeAndBuildTransition, coordinateColdPrompt } from './transitionDecider.js';
import { buildCrossDayPrompt } from './crossDayAwareness.js';
import {
  fitContextByBudget,
  systemMsg,
  PRIORITY,
  formatBudgetReport,
  computeBudget,
  getWorldBookBudgetRatio,
} from './tokenBudget.js';

class SenderState {
  constructor(convId) {
    this.convId = convId;
    this.msgId = null;
    this.content = '';
    this.addPromise = null;
    this.abortController = null;
  }
}
const _activeSenders = new Map();

export function setChatContainer(container) {
  chatUI.setChatContainer(container);
}

/**
 * 中止指定会话的流式请求
 * @param {string} convId
 * @returns {boolean} 是否成功发出中止信号
 */
export function abortSendMessage(convId) {
  const sender = _activeSenders.get(convId);
  if (sender && sender.abortController) {
    try {
      sender.abortController.abort();
      return true;
    } catch (e) {
      console.warn('[Chat] abort 失败:', e);
      return false;
    }
  }
  return false;
}

/**
 * 中止当前会话的流式请求（从 state 获取 convId）
 * @returns {boolean}
 */
export function abortCurrentSendMessage() {
  const convId = getAppState().get('currentConversationId');
  if (!convId) return false;
  return abortSendMessage(convId);
}

function getConversationStateSettings() {
  const settings = getAppState().get('settings') || {};
  const cs = settings.conversationState || {};
  return {
    enabled: cs.enabled !== false,
    crossDayEnabled: cs.crossDayEnabled !== false,
    transitionEnabled: cs.transitionEnabled !== false,
  };
}

function _isTargetStillActive(targetCharacterId) {
  const s = getAppState();
  return s.get('currentCharacterId') === targetCharacterId
      && s.get('currentMode') === 'chat';
}

export async function renderConversation(convId) {
  const char = getCurrentCharacter();
  if (char && char.unreadProactiveMessage) {
    try {
      await updateCharacter(
        char.id,
        { unreadProactiveMessage: null, unreadProactiveType: null },
        { skipReload: true }
      );
      const { renderCharacterList } = await import('../ui/screens/characterListUI.js');
      renderCharacterList();
    } catch (e) {
      console.warn('[Chat] 清除未读标记失败:', e);
    }
  }

  const stores = await getStores();
  let convData = await stores.conversations.get(convId);
  if (!convData) return;

  const targetCharacterId = convData.characterId;

  if (convData.messages.length === 0 && char) {
    const isSleeping = char.bodyState?.sleepStatus === '浅睡' || char.bodyState?.sleepStatus === '深睡';
    if (isSleeping) {
      const sleepMsg = getSleepRefusalMessage(char);
      const msg = {
        id: generateUUID(),
        role: 'assistant',
        content: sleepMsg,
        timestamp: getGameTime(),
      };
      await addMessageToConversation(convId, msg);

      if (!_isTargetStillActive(targetCharacterId)) {
        console.debug('[Chat] renderConversation 跳过：目标角色已切换（睡眠消息分支）');
        return;
      }

      convData = await stores.conversations.get(convId);
    } else {
      if (char.generateFirstMessage !== false) {
        await ensureFirstMessage(char, convId);
      } else {
        const preset = char.firstMessage;
        if (preset) {
          const msg = {
            id: generateUUID(),
            role: 'assistant',
            content: preset,
            timestamp: getGameTime(),
          };
          await addMessageToConversation(convId, msg);
        }
      }

      if (!_isTargetStillActive(targetCharacterId)) {
        console.debug('[Chat] renderConversation 跳过：目标角色已切换（开场白分支）');
        return;
      }

      convData = await stores.conversations.get(convId);
    }
  }

  chatUI.renderConversationData(convData);
}

export async function sendMessage(content) {
  const state = getAppState();

  if (state.get('sending')) {
    console.warn('[Chat] 已有消息正在发送中，忽略本次请求');
    return;
  }

  state.set('sending', true);

  let convId = null;
  let character = null;

  try {
    const { executeCommand } = await import('./commandEngine.js');
    const { showBanner } = await import('../ui/components/banner.js');

    const commandContext = {
      character: getCurrentCharacter(),
      conversation: await getCurrentConversation(),
      state: state,
      settings: state.get('settings') || {},
    };

    const cmdResult = await executeCommand(content, commandContext);
    if (cmdResult.handled) {
      if (cmdResult.banner) {
        showBanner(cmdResult.banner, 4000, cmdResult.banner.includes('❌') ? 'error' : 'info');
      }
      return;
    }

    await syncTime();

    character = getCurrentCharacter();
    if (!character) {
      showToast('请先选择一个角色', 'warning');
      return;
    }

    await syncCharacterState(character.id);

    {
      const fresh = (state.get('characters') || []).find(c => c.id === character.id);
      if (fresh) {
        character = fresh;
      }
    }

    convId = state.get('currentConversationId');
    if (!convId) {
      const { ensureConversation } = await import('./conversation.js');
      const conv = await ensureConversation(character.id);
      convId = conv.id;
      state.set('currentConversationId', convId);
    }

    const sendBtn = document.getElementById('sendBtn');
    if (sendBtn) sendBtn.disabled = true;

    const userMsg = {
      id: generateUUID(),
      role: 'user',
      content: content.trim(),
      timestamp: getGameTime(),
    };
    await addMessageToConversation(convId, userMsg);

    if (state.get('currentCharacterId') === character.id
        && state.get('currentMode') === 'chat') {
      chatUI.appendMessage(userMsg);
    }

    const input = document.getElementById('messageInput');
    if (input) input.value = '';
    const currentUserMsgId = userMsg.id;

    globalEventBus.emit('message:before-send', {
      characterId: character.id,
      content: content.trim(),
      timestamp: getGameTime(),
    });

    if (character.bodyState.sleepStatus === '浅睡' || character.bodyState.sleepStatus === '深睡') {
      const callCount = state.get('callCount') || 0;
      const result = await tryWakeUp(character, callCount);
      if (result.success) {
        state.set('callCount', 0);
      } else if (result.refusal) {
        state.set('callCount', callCount + 1);
        const refusalMsg = getSleepRefusalMessage(character);
        const msg = {
          id: generateUUID(),
          role: 'assistant',
          content: refusalMsg,
          timestamp: getGameTime(),
        };
        await addMessageToConversation(convId, msg);
        if (state.get('currentCharacterId') === character.id
            && state.get('currentMode') === 'chat') {
          chatUI.appendMessage(msg);
        }
        return;
      }
    } else {
      state.set('callCount', 0);
    }

    const settings = state.get('settings') || {};
    const useLLM = settings.useLLMForEmotion || false;
    const analysis = await classifyUserMessage(content, useLLM);

    const now = getGameTime();
    const lastInteraction = character.lastInteraction?.gameTime || now;
    const hoursSince = (now - lastInteraction) / (1000 * 60 * 60);
    let coldPrompt = '';
    if (hoursSince > 2) {
      let coldDesc = '';
      if (hoursSince < 6) coldDesc = `你感觉用户刚刚离开不久，有点挂念。`;
      else if (hoursSince < 24) coldDesc = `用户已经离开${Math.round(hoursSince)}小时了，你感到有些寂寞。`;
      else if (hoursSince < 72) coldDesc = `用户已经${Math.round(hoursSince / 24)}天没出现了，你开始想念，甚至有些失落。`;
      else coldDesc = `用户已经${Math.round(hoursSince / 24)}天没联系你了，你感到孤独和一丝怨念。`;
      coldPrompt = `【冷落感知】${coldDesc} 请在回复中自然地体现出这种情绪，如果你想念用户，可以适当表达。`;
    }

    await updateCharacter(
      character.id,
      { lastInteraction: { gameTime: now, realTime: Date.now() } },
      { skipReload: true }
    );

    if (analysis.type !== 'neutral') {
      await handleInteraction(character, analysis.type, analysis.intensity);
    }

    const bodyEventMap = {
      'praise': 'praise',
      'criticism': 'criticism',
      'care': 'care',
      'funny': 'funny',
      'intimate': 'intimate',
      'neglect': 'neglect',
    };
    if (bodyEventMap[analysis.type]) {
      await handleBodyEvent(character, bodyEventMap[analysis.type], analysis.intensity);
    }


    try {
      const { checkAndApplyInjury } = await import('./injuryEngine.js');
      const injured = await checkAndApplyInjury(character, content.trim());

      if (injured) {
        await syncCharacterState(character.id);
        const appState = getAppState();
        const charList = appState.get('characters') || [];
        const latestChar = charList.find(c => c.id === character.id);
        if (latestChar) {
          character = latestChar;
        }
      }
    } catch (e) {
      console.warn('[Chat] 受伤检查失败:', e);
    }

    const stores = await getStores();
    const convData = await stores.conversations.get(convId);
    const contextMode = settings?.contextMode || 'smart';

    const csSettings = getConversationStateSettings();

    let transitionResult = { decision: { strategy: 'none' }, prompt: '' };
    if (csSettings.enabled && csSettings.transitionEnabled) {
      try {
        transitionResult = await analyzeAndBuildTransition(convData, character, content.trim());
      } catch (e) {
        console.warn('[Chat] 场景转场分析失败:', e);
      }
    } else {
      console.log('[Chat] 场景转场已关闭，跳过');
    }
    const { decision: transitionDecision, prompt: transitionPrompt } = transitionResult;

    let crossDayPrompt = '';
    if (csSettings.enabled && csSettings.crossDayEnabled) {
      try {
        crossDayPrompt = buildCrossDayPrompt(convData, character, { scene: 'chat' });
      } catch (e) {
        console.warn('[Chat] 跨天感知失败:', e);
      }
    } else {
      console.log('[Chat] 跨天感知已关闭，跳过');
    }

    coldPrompt = coordinateColdPrompt(transitionDecision, coldPrompt);

    const systemMessages = [];

    const emotionPrompt = buildEmotionPrompt(character);
    if (emotionPrompt) {
      systemMessages.push(systemMsg(emotionPrompt, 'emotion', PRIORITY.EMOTION));
    }

    const bodyPrompt = buildBodyPrompt(character);
    if (bodyPrompt) {
      systemMessages.push(systemMsg(bodyPrompt, 'body', PRIORITY.BODY));
    }

    if (transitionPrompt) {
      systemMessages.push(systemMsg(transitionPrompt, 'transition', PRIORITY.TRANSITION));
    }
    if (crossDayPrompt) {
      systemMessages.push(systemMsg(crossDayPrompt, 'crossday', PRIORITY.CROSS_DAY));
    }
    if (coldPrompt) {
      systemMessages.push(systemMsg(coldPrompt, 'cold', PRIORITY.COLD));
    }

    if (character.dialogueExamples && character.dialogueExamples.trim()) {
      const exampleText = `【对话风格参考】\n以下是该角色的典型对话示例，请模仿其语气和风格：\n${character.dialogueExamples}`;
      systemMessages.push(systemMsg(exampleText, 'examples', PRIORITY.EXAMPLES));
    }

    const pendingInjection = state.get('pendingInjection');
    if (pendingInjection) {
      systemMessages.push(systemMsg(`【临时注入】${pendingInjection}`, 'injection', PRIORITY.USER_CONTEXT));
      state.set('pendingInjection', null);
    }

    let historyMessages = [];
    const summary = convData.summary || '';

    if (contextMode === 'full') {
      historyMessages = convData.messages.map(m => ({ role: m.role, content: m.content }));
    } else if (contextMode === 'summary_only') {
      if (summary) {
        systemMessages.push(systemMsg(`【对话摘要】${summary}`, 'summary', PRIORITY.SUMMARY));
      } else {
        const lastMsg = convData.messages.slice(-1);
        if (lastMsg.length) historyMessages = lastMsg.map(m => ({ role: m.role, content: m.content }));
      }
    } else {
      historyMessages = convData.messages.slice(-20).map(m => ({ role: m.role, content: m.content }));
      if (summary) {
        systemMessages.push(systemMsg(`【对话摘要】${summary}`, 'summary', PRIORITY.SUMMARY));
      }
      try {
        const memoryResults = await searchMemories(character.id, content.trim(), 5);
        if (memoryResults.length > 0) {
          let memoryContext = '【长期记忆】以下是您之前与我的相关对话片段，供参考：\n';
          memoryResults.forEach((mem, idx) => {
            memoryContext += `[${idx + 1}] 您曾问："${mem.userMessage}"\n我回答："${mem.assistantMessage}"\n`;
          });
          systemMessages.push(systemMsg(memoryContext, 'memory', PRIORITY.MEMORY));
        }
      } catch (e) {
        console.warn('[Chat] 记忆检索失败:', e);
      }
    }

    const modelName = settings?.modelName;
    const tbEnabled = settings.tokenBudget?.enabled !== false;
    const wbBudgetRatio = getWorldBookBudgetRatio();

    let worldBookBudget;
    let systemBudgetOverride;

    if (tbEnabled) {
      const rawBudget = computeBudget(modelName);
      const rawSystemBudget = rawBudget.breakdown.system;
      worldBookBudget = Math.floor(rawSystemBudget * wbBudgetRatio);
      systemBudgetOverride = rawSystemBudget - worldBookBudget;
    } else {
      const rawBudget = computeBudget(modelName);
      worldBookBudget = Math.floor(rawBudget.breakdown.system * wbBudgetRatio);
      systemBudgetOverride = undefined;
    }

    const budgetResult = fitContextByBudget({
      modelName,
      systemMessages,
      historyMessages,
      userMessage: '',
      summary,
      systemBudgetOverride,
    });

    console.log(formatBudgetReport(budgetResult.stats));

    if (typeof window !== 'undefined') {
      window.__lastBudgetStats = budgetResult.stats;
    }

    console.log(`[Chat] 世界书预算: ${worldBookBudget} tokens (原始系统预算 ${budgetResult.stats.systemBudget + (systemBudgetOverride !== undefined ? worldBookBudget : 0)} × ${wbBudgetRatio})`);

    let messagesForAPI = [
      ...budgetResult.systemKept.map(m => ({ role: 'system', content: m.content })),
      ...budgetResult.historyKept,
    ];

    const timeContext = getTimeContext();

    const context = {
      character,
      emotionState: character.emotionState,
      bodyState: character.bodyState,
      user: {
        ...(state.get('settings')?.user || { name: '用户' }),
        message: content,
      },
      conversation: convData,
      ...timeContext,
    };

    let finalMessages = [];
    try {
      const result = await applyInjection(messagesForAPI, context, { worldBookBudget });
      console.log('[Chat] 注入后消息数:', result.length);
      finalMessages = result;
    } catch (e) {
      console.warn('[Chat] 注入器执行失败，使用降级方案:', e);

      const degradedSystemMsgs = messagesForAPI
        .filter(msg => msg.role === 'system')
        .map(msg => msg.content)
        .filter(content => content && content.trim());

      const degradedSystem = [
        character.systemPrompt || '',
        ...degradedSystemMsgs,
      ]
        .filter(Boolean)
        .join('\n\n');

      finalMessages = [
        ...(degradedSystem ? [{ role: 'system', content: degradedSystem }] : []),
        ...messagesForAPI.filter(msg => msg.role !== 'system'),
      ];
    }

    const sender = new SenderState(convId);
    sender.abortController = new AbortController();
    _activeSenders.set(convId, sender);

    try {
      await sendChatRequest({
        messages: finalMessages,
        systemPrompt: '',
        preserveSystemInMessages: true,
        model: state.get('settings')?.modelName,
        stream: true,
        signal: sender.abortController.signal,
        onChunk: (chunk) => {
          const current = _activeSenders.get(convId);
          if (!current) return;

          const isCurrentConv = state.get('currentCharacterId') === character.id
                            && state.get('currentMode') === 'chat';

          if (!current.msgId) {
            current.msgId = generateUUID();
            const assistantMsg = {
              id: current.msgId,
              role: 'assistant',
              content: '',
              timestamp: getGameTime(),
            };

            current.addPromise = addMessageToConversation(convId, assistantMsg);

            if (isCurrentConv) {
              chatUI.appendMessage(assistantMsg);
            }
          }

          current.content += chunk;

          if (isCurrentConv) {
            chatUI.updateMessageContent(current.msgId, current.content);
            chatUI.scrollToBottom();
          }
        },
      });

      if (sender.addPromise) {
        try {
          await sender.addPromise;
        } catch (e) {
          console.warn('[Chat] 首次 chunk 落库失败:', e);
        }
      }

      const finalContent = sender.content;

      if (!finalContent || !finalContent.trim()) {
        if (sender.msgId) {
          await removeMessageFromConversation(convId, sender.msgId);
          chatUI.removeMessage(sender.msgId);
        }
        return;
      }

      const msgFound = await updateConversationWithLock(convId, (conv) => {
        const msgIndex = conv.messages.findIndex(m => m.id === sender.msgId);
        if (msgIndex === -1) return false;
        conv.messages[msgIndex].content = finalContent;
        return true;
      });

      if (!msgFound) {
        console.warn('[Chat] assistant 消息已丢失（msgIndex=-1），重新写入');
        await addMessageToConversation(convId, {
          id: sender.msgId,
          role: 'assistant',
          content: finalContent,
          timestamp: getGameTime(),
        });
      }

      if (finalContent && finalContent.trim()) {
        await addMemory(character.id, content.trim(), finalContent);
      }

      if (sender.msgId) {
        const isCurrentConvForFinal = state.get('currentCharacterId') === character.id
                                  && state.get('currentMode') === 'chat';
        if (isCurrentConvForFinal) {
          chatUI.updateMessageContent(sender.msgId, finalContent, true);
        }
      }

      const summaryFrequency = settings?.summaryFrequency ?? 10;
      if (settings?.summaryEnabled !== false && summaryFrequency > 0) {
        const summaryCharacter = character;
        Promise.resolve().then(async () => {
          const maxLen = settings.summaryMaxLength ?? 200;
          const conv = await stores.conversations.get(convId);
          if (conv && shouldGenerateSummary(conv.messages, summaryFrequency, conv.lastSummaryIndex || 0)) {
            const messagesToSummarize = getMessagesToSummarize(conv.messages, conv.lastSummaryIndex || 0, summaryFrequency);
            if (messagesToSummarize.length > 0) {
              const text = formatMessagesForSummary(messagesToSummarize);
              const newSummary = await generateSummary(text, conv.summary || '', maxLen, summaryCharacter);
              await updateConversationSummary(convId, newSummary, conv.lastSummaryIndex + messagesToSummarize.length);
              console.log('[Summary] 摘要已更新');
            }
          }
        });
      }

      const stillCurrentAfterStream = state.get('currentCharacterId') === character.id;
      await loadConversations(character.id, { updateState: stillCurrentAfterStream });

      globalEventBus.emit('message:received', {
        characterId: character.id,
        content: finalContent,
        timestamp: getGameTime(),
      });

    } catch (error) {
      if (error.name === 'AbortError') {
        console.log('[Chat] 用户取消了请求');

        if (sender.addPromise) {
          try { await sender.addPromise; } catch (_) {}
        }

        if (sender.msgId) {
          const hasContent = sender.content && sender.content.trim();

          if (hasContent) {
            // 保留已生成的部分内容，标记为 interrupted
            try {
              await updateConversationWithLock(convId, (conv) => {
                const msgIndex = conv.messages.findIndex(m => m.id === sender.msgId);
                if (msgIndex !== -1) {
                  conv.messages[msgIndex].content = sender.content;
                  conv.messages[msgIndex].interrupted = true;
                }
              });
            } catch (e) {
              console.warn('[Chat] 中断后保存部分内容失败:', e);
            }
          } else {
            // 无内容，清理空的 assistant 消息
            await removeMessageFromConversation(convId, sender.msgId);
            chatUI.removeMessage(sender.msgId);
          }
        }

        showToast('已停止生成', 'info');
      } else {
        // 其他错误：与修复前行为一致，全部清理
        console.error('发送失败:', error);
        showToast('发送失败: ' + error.message, 'error');

        await removeMessageFromConversation(convId, currentUserMsgId);
        chatUI.removeMessage(currentUserMsgId);

        if (sender.msgId) {
          if (sender.addPromise) {
            try { await sender.addPromise; } catch (_) {}
          }
          await removeMessageFromConversation(convId, sender.msgId);
          chatUI.removeMessage(sender.msgId);
        }
      }

      const stillCurrentAfterError = state.get('currentCharacterId') === character.id;
      await loadConversations(character.id, { updateState: stillCurrentAfterError });
    } finally {
      _activeSenders.delete(convId);
    }

  } finally {
    state.set('sending', false);
    const sendBtn = document.getElementById('sendBtn');
    if (sendBtn) sendBtn.disabled = false;

    const isCurrentConvForScroll = character
      && state.get('currentCharacterId') === character.id
      && state.get('currentMode') === 'chat';
    if (isCurrentConvForScroll) {
      chatUI.scrollToBottom();
    }
  }
}

export { clearConversation };

function initChatAutoRender() {
  const state = getAppState();

  let isRendering = false;
  let latestTargetId = null;
  let latestToken = 0;
  let lastRenderedToken = 0;

  const performRender = async (charId, token) => {
    const currentMode = state.get('currentMode');
    if (currentMode === 'group') {
      return;
    }

    const container = document.getElementById('chatMessages');
    if (container) {
      container.innerHTML = '';
      container.className = '';
      container.style.backgroundImage = '';
    }

    if (!charId) return;

    try {
      const { ensureConversation } = await import('./conversation.js');
      const conv = await ensureConversation(charId);

      if (token !== latestToken) return;

      if (conv) {
        await renderConversation(conv.id);
      }
    } catch (err) {
      console.warn('[Chat] 自动渲染失败:', err);
    }
  };

  const drain = async () => {
    if (isRendering) return;
    isRendering = true;
    try {
      while (latestToken !== lastRenderedToken) {
        const myToken = latestToken;
        const myTarget = latestTargetId;
        lastRenderedToken = myToken;
        await performRender(myTarget, myToken);
      }
    } finally {
      isRendering = false;
    }
  };

  state.subscribe('currentCharacterId', (newId) => {
    latestTargetId = newId;
    latestToken++;
    drain();
  });
}

initChatAutoRender();