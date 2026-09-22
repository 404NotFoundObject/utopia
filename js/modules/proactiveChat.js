// js/modules/proactiveChat.js - 主动对话引擎
import { getAppState } from '../core/state.js';
import { getStores } from '../core/db.js';
import { getGameTime, getTimeContext } from './time.js';
import { sendChatRequest } from '../core/api.js';
import { updateCharacter } from './character.js';
import { addMessageToConversation, ensureConversation } from './conversation.js';
import { buildEmotionPrompt } from './emotionEngine.js';
import { buildBodyPrompt } from './bodyState.js';
import { generateUUID } from '../core/utils.js';
import { showBanner } from '../ui/components/banner.js';
import { appendConsoleMessage } from '../ui/components/console.js';
import globalEventBus from '../core/eventBus.js';
import { startVoiceCall } from '../ui/screens/voiceCallUI.js';

import { buildCrossDayPrompt } from './crossDayAwareness.js';
import { getConversationPhase, normalizeConvState } from './conversationState.js';
import { getSceneDef, isSensitive } from './sceneRegistry.js';

import { applyInjection } from './injector.js';
import {
  fitContextByBudget,
  systemMsg,
  PRIORITY,
  computeBudget,
  getWorldBookBudgetRatio,
} from './tokenBudget.js';

const DEFAULT_CONFIG = {
  enabled: true,
  minIdleGameHours: 6,
  minIdleRealMinutes: 20,
  checkInterval: 60000,
  maxPerCycle: 2,
  cooldownGameHours: 24,
  chanceVoice: 0.3,
};

let timerId = null;
let _startupTimerId = null;
let isRunning = false;

function isDebugEnabled() {
  return typeof window !== 'undefined' && window.__DEBUG__ === true;
}

function getConfig() {
  const settings = getAppState().get('settings') || {};
  return { ...DEFAULT_CONFIG, ...(settings.proactiveChat || {}) };
}

export function getEligibleCharacters(characters) {
  const config = getConfig();
  if (!config.enabled) return [];

  const nowGame = getGameTime();
  const nowReal = Date.now();

  return characters.filter(char => {
    const sleepStatus = char.bodyState?.sleepStatus;
    if (sleepStatus === '深睡' || sleepStatus === '浅睡' || sleepStatus === '昏厥') return false;

    const last = char.lastInteraction;
    if (!last) return true;

    const gameHoursSince = (nowGame - last.gameTime) / (1000 * 60 * 60);
    if (gameHoursSince < config.minIdleGameHours) return false;

    const realMinutesSince = (nowReal - last.realTime) / (1000 * 60);
    if (realMinutesSince < config.minIdleRealMinutes) return false;

    const lastProactive = char.lastProactiveTime || 0;
    const cooldownMs = config.cooldownGameHours * 3600 * 1000;
    if (nowGame - lastProactive < cooldownMs) return false;

    return true;
  });
}

// ============================================================
// buildPersonaBrief（不含 systemPrompt）
// ============================================================
export function buildPersonaBrief(character) {
  let text = '【角色设定】\n';
  text += `名称：${character.name}\n`;
  if (character.description) text += `描述：${character.description}\n`;
  if (character.personality) text += `性格：${character.personality}\n`;
  if (character.relationship) text += `与用户关系：${character.relationship}\n`;
  if (character.callUser) text += `对用户的称呼：${character.callUser}\n`;
  if (character.gender && character.gender !== 'unknown') {
    const genderMap = { male: '男', female: '女', 'non-binary': '非二元' };
    text += `性别：${genderMap[character.gender] || character.gender}\n`;
  }
  return text;
}

// ============================================================
// buildPersonaSystemMessage（含 systemPrompt，兼容 API）
// ============================================================
export function buildPersonaSystemMessage(character) {
  let personaText = '【角色设定】\n';
  personaText += `名称：${character.name}\n`;
  if (character.description) personaText += `描述：${character.description}\n`;
  if (character.personality) personaText += `性格：${character.personality}\n`;
  if (character.relationship) personaText += `与用户关系：${character.relationship}\n`;
  if (character.callUser) personaText += `对用户的称呼：${character.callUser}\n`;
  if (character.gender && character.gender !== 'unknown') {
    const genderMap = { male: '男', female: '女', 'non-binary': '非二元' };
    personaText += `性别：${genderMap[character.gender] || character.gender}\n`;
  }
  if (character.systemPrompt) {
    personaText += `\n【系统提示】${character.systemPrompt}`;
  }
  return personaText;
}

async function buildProactiveContext(character, extraContext = {}) {
  const result = {
    crossDayPrompt: '',
    scenePrompt: '',
    phase: null,
    scene: null,
  };

  const settings = getAppState().get('settings') || {};
  const cs = settings.conversationState || {};
  const csEnabled = cs.enabled !== false;
  const crossDayEnabled = cs.crossDayEnabled !== false;
  const transitionEnabled = cs.transitionEnabled !== false;

  if (!csEnabled) {
    if (isDebugEnabled()) console.log('[Proactive] 会话状态机已关闭，跳过跨天/场景分析');
    return result;
  }

  try {
    const stores = await getStores();
    const convs = await stores.conversations.getByIndex('characterId', character.id);
    if (!convs || convs.length === 0) return result;

    const conv = convs.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))[0];
    if (!conv) return result;

    if (crossDayEnabled) {
      const phase = getConversationPhase(conv);
      result.phase = phase;

      if (phase.phase !== 'empty' && phase.phase !== 'active') {
        result.crossDayPrompt = buildCrossDayPrompt(conv, character, { scene: 'proactive' });
      }
    }

    if (transitionEnabled) {
      const state = normalizeConvState(conv);
      if (state.currentScene) {
        result.scene = state.currentScene;
        const sceneDef = getSceneDef(state.currentScene.type);
        const elapsedHours = (getGameTime() - (state.currentScene.lastSeenAt || 0)) / (1000 * 60 * 60);

        if (sceneDef.sensitivity === 'high' && elapsedHours > sceneDef.maxDuration) {
          if (state.currentScene.type === 'conflict') {
            result.scenePrompt = `【场景提示】你们上次在争执中结束。你主动找用户，语气要保持一点"还在闹别扭但愿意给个台阶"的状态，不要过于热情，也不要直接道歉，可以有点小情绪但别真的伤人。`;
          } else if (state.currentScene.type === 'intimate') {
            result.scenePrompt = `【场景提示】你们上次在亲密互动中。\n\n⚠️ 重要：距离上次已经过去 ${Math.round(elapsedHours)} 小时，这段亲密互动已经结束。不要假装刚才还在进行。\n\n主动找用户时，请用日常语气，不要主动提起上次的亲密细节。`;
          }
        } else if (result.phase?.phase === 'interrupted' && elapsedHours < 24) {
          result.scenePrompt = `【场景提示】上次用户话说到一半就离开了。你主动找他时，可以顺便关心地问一句"上次你想说什么来着"，但不要显得在追问。`;
        }
      }
    }
  } catch (e) {
    console.warn('[Proactive] 构建主动上下文失败:', e);
  }

  return result;
}

// ============================================================
// generateProactiveMessage
// ============================================================
export async function generateProactiveMessage(character, extraContext = {}, customPrompt = null) {
  const state = getAppState();
  const settings = state.get('settings') || {};

  const systemMessages = [];

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
    `【当前游戏时间】${timeCtx.gameTime.natural}\n${timeCtx.gameTime.description}`,
    'time',
    PRIORITY.TIME
  ));

  const proactiveContext = await buildProactiveContext(character, extraContext);
  if (proactiveContext.crossDayPrompt) {
    systemMessages.push(systemMsg(proactiveContext.crossDayPrompt, 'crossday', PRIORITY.CROSS_DAY));
  }
  if (proactiveContext.scenePrompt) {
    systemMessages.push(systemMsg(proactiveContext.scenePrompt, 'transition', PRIORITY.TRANSITION));
  }

  const lastInteraction = extraContext.lastInteraction || character.lastInteraction;
  if (lastInteraction) {
    const now = getGameTime();
    const hoursSince = (now - lastInteraction.gameTime) / (1000 * 60 * 60);
    if (hoursSince > 2) {
      let coldDesc = '';
      if (hoursSince < 6) {
        coldDesc = `你刚和用户分开不久，想主动分享一件小事。`;
      } else if (hoursSince < 24) {
        coldDesc = `用户今天还没出现，你有点想他，想主动问候一下。`;
      } else if (hoursSince < 72) {
        coldDesc = `用户已经${Math.round(hoursSince / 24)}天没出现了，你很想念，想主动找他。语气是期待和想念，而不是抱怨或讽刺。`;
      } else {
        coldDesc = `用户已经${Math.round(hoursSince / 24)}天没联系你了。不要抱怨，不要讽刺，只是自然地表达你想他了——像一个真正关心人的朋友主动发起的问候。`;
      }
      systemMessages.push(systemMsg(`【冷落感知】${coldDesc}`, 'cold', PRIORITY.COLD));
    }
  }

  const summary = extraContext.summary || '';
  if (summary) {
    systemMessages.push(systemMsg(`【最近对话摘要】${summary}`, 'summary', PRIORITY.SUMMARY));
  }

  const instruction = customPrompt || `现在请主动给用户发一条消息。要求：
- 结合你的性格、当前情感状态、身体状态，以及你们最近的互动
- 10-40 字，语言自然，符合人设
- 可以是分享心情、询问近况、表达想念、分享一个有趣的小事
- 不要使用"你好"之类过于通用的开场
- 直接输出你要说的话，不要添加任何前缀或说明`;

  const rawMessages = [
    ...systemMessages,
    { role: 'user', content: instruction },
  ];

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
    historyMessages: [],
    userMessage: '',
    summary: '',
    systemBudgetOverride,
  });

  const messagesForAPI = [
    ...budgetResult.systemKept.map(m => ({ role: 'system', content: m.content })),
    { role: 'user', content: instruction },
  ];

  const context = {
    character,
    emotionState: character.emotionState,
    bodyState: character.bodyState,
    user: {
      ...(settings.user || { name: '用户' }),
      message: '',
    },
    conversation: null,
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
    console.warn('[Proactive] 注入器执行失败，使用降级方案:', e);
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

  if (isDebugEnabled()) {
    console.log(`\n%c💬 [开场白/主动消息] 注入内容 (角色: ${character.name})`, 'font-size:14px;font-weight:bold;color:#6c5ce7;');
    console.log('%c━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━', 'color:#6a6a8a;');

    const allForLog = [
      { role: 'system', content: fullSystem },
      ...finalMessages,
    ];
    allForLog.forEach((msg, idx) => {
      const roleColor = msg.role === 'system' ? '#f39c12' : '#2ecc71';
      const roleLabel = msg.role === 'system' ? '🟡 SYSTEM' : '🟢 USER';
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
  }

  let response = await sendChatRequest({
    messages: finalMessages,
    systemPrompt: fullSystem,
    model: modelName,
    temperature: 0.85,
    maxTokens: 500,
    stream: false,
  });

  let content = response.content?.trim();

  if (!content) {
    console.warn(`[Proactive] ${character.name} 首次生成空回复，尝试重试`);
    try {
      response = await sendChatRequest({
        messages: finalMessages,
        systemPrompt: fullSystem,
        model: modelName,
        temperature: 0.9,
        maxTokens: 500,
        stream: false,
      });
      content = response.content?.trim();
    } catch (e) {
      console.warn(`[Proactive] ${character.name} 重试失败:`, e);
    }
  }

  if (!content) {
    console.warn(`[Proactive] ${character.name} 重试后仍为空，放弃本次主动消息`);
    return null;
  }

  return content;
}

/**
 * 插入主动消息
 */
export async function insertProactiveMessage(character, content, convId, options = {}) {
  const { silent = false, isVoice = false } = options;
  const stores = await getStores();
  let conv = convId ? await stores.conversations.get(convId) : null;
  if (!conv) {
    conv = await ensureConversation(character.id, { silent: true });
  }

  const msg = {
    id: generateUUID(),
    role: 'assistant',
    content: content,
    timestamp: getGameTime(),
    isProactive: true,
    isVoice: isVoice,
  };
  await addMessageToConversation(conv.id, msg);

  if (!silent && !isVoice) {
    await updateCharacter(character.id, {
      unreadProactiveMessage: content,
      unreadProactiveType: 'message',
      lastProactiveTime: getGameTime(),
    });
    globalEventBus.emit('proactive:new', {
      characterId: character.id,
      type: 'message',
      content: content,
    });
  } else if (!silent) {
    await updateCharacter(character.id, {
      lastProactiveTime: getGameTime(),
    });
  }

  const state = getAppState();
  const currentCharId = state.get('currentCharacterId');
  if (currentCharId === character.id && !state.get('currentGroupId') && !isVoice) {
    const { appendMessage, scrollToBottom } = await import('../ui/screens/chatUI.js');

    const state2 = getAppState();
    if (state2.get('currentCharacterId') === character.id
        && state2.get('currentMode') === 'chat') {
      appendMessage(msg);
      scrollToBottom();
    }
  } else if (!silent && !isVoice) {
    showBanner(`💬 ${character.name} 发来一条消息`, 4000, 'info');
    appendConsoleMessage(`[主动消息] ${character.name}: ${content}`, 'info');
  }

  return conv.id;
}

export async function sendProactiveMessage(character) {
  try {
    const content = await generateProactiveMessage(character);
    if (!content) return false;
    await insertProactiveMessage(character, content, null, { silent: false, isVoice: false });
    return true;
  } catch (error) {
    console.error(`[Proactive] ${character.name} 主动发送失败:`, error);
    return false;
  }
}

export async function startProactiveVoiceCall(character) {
  await startVoiceCall(character, { proactive: true });
}

export async function runProactiveCheck() {
  const state = getAppState();
  const config = getConfig();
  if (!config.enabled) return;
  if (state.get('sending')) {
    if (isDebugEnabled()) console.log('[Proactive] 用户正在发送消息，跳过本轮扫描');
    return;
  }

  const characters = state.get('characters') || [];
  if (characters.length === 0) return;

  const eligible = getEligibleCharacters(characters);
  if (eligible.length === 0) return;

  const shuffled = eligible.sort(() => Math.random() - 0.5);
  const count = Math.min(shuffled.length, config.maxPerCycle);
  const selected = shuffled.slice(0, count);

  let hasVoiceTriggered = false;

  if (isDebugEnabled()) {
    console.log(`[Proactive] 本轮筛选出 ${eligible.length} 个候选，选定 ${count} 个，语音通话限制: 最多1个`);
  }

  for (const char of selected) {
    let shouldVoice;
    if (hasVoiceTriggered) {
      shouldVoice = false;
      if (isDebugEnabled()) console.log(`[Proactive] 已有语音通话触发，${char.name} 强制走消息`);
    } else {
      shouldVoice = Math.random() < config.chanceVoice;
    }

    if (shouldVoice) {
      await startProactiveVoiceCall(char);
      hasVoiceTriggered = true;
    } else {
      await sendProactiveMessage(char);
    }
    await sleep(2000);
  }
}

export function startProactiveChat() {
  if (isRunning) return;
  const config = getConfig();
  if (!config.enabled) return;

  if (timerId) clearInterval(timerId);
  if (_startupTimerId) clearTimeout(_startupTimerId);

  _startupTimerId = setTimeout(() => {
    _startupTimerId = null;
    runProactiveCheck().catch(console.error);
  }, 3000);

  timerId = setInterval(() => runProactiveCheck().catch(console.error), config.checkInterval);
  isRunning = true;
  if (isDebugEnabled()) console.log(`[Proactive] 引擎已启动，间隔 ${config.checkInterval / 1000}s`);
}

export function stopProactiveChat() {
  if (timerId) {
    clearInterval(timerId);
    timerId = null;
  }
  if (_startupTimerId) {
    clearTimeout(_startupTimerId);
    _startupTimerId = null;
    if (isDebugEnabled()) console.log('[Proactive] 已取消启动延时器');
  }
  isRunning = false;
  if (isDebugEnabled()) console.log('[Proactive] 引擎已停止');
}

export function reloadProactiveChat() {
  stopProactiveChat();
  startProactiveChat();
}

globalEventBus.on('settings:updated', reloadProactiveChat);

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}