// js/modules/firstMessage.js - 动态开场白生成
import { sendChatRequest } from '../core/api.js';
import { getTimeContext, getGameTime } from './time.js';
import { addMessageToConversation } from './conversation.js';
import { getAppState } from '../core/state.js';
import { applyInjection } from './injector.js';
import { buildEmotionPrompt } from './emotionEngine.js';
import { buildBodyPrompt } from './bodyState.js';
import { generateUUID } from '../core/utils.js';
import {
  systemMsg,
  PRIORITY,
  fitContextByBudget,
  computeBudget,
  getWorldBookBudgetRatio,
} from './tokenBudget.js';

const pendingLocks = new Map();

function buildFirstMessagePrompt(character) {
  const timeCtx = getTimeContext();
  const timeStr = timeCtx.gameTime.natural || '未知时间';
  const scene = character.scene || '初次相遇';

  let personalityDesc = '';
  if (character.personalityParameters) {
    const p = character.personalityParameters;
    personalityDesc = `性格特质：神经质${p.neuroticism}，外向性${p.extraversion}，宜人性${p.agreeableness}，开放性${p.openness}，尽责性${p.conscientiousness}，表达性${p.expressiveness}。`;
  }

  return `你是一个角色扮演助手。请根据以下角色设定，生成一段自然、生动的开场白（约 1-3 句话），作为该角色与用户初次相遇时的第一句话。

角色信息：
- 名称：${character.name}
- 简介：${character.description || '无'}
- 性格：${character.personality || '无'}
- 关系：${character.relationship || '无'}
- ${personalityDesc}

当前游戏世界时间：${timeStr}
初次相遇场景：${scene}

请直接输出开场白文本，不要添加任何解释或前缀。要求：语言自然，符合角色人设和当前情境。`;
}

export async function generateFirstMessage(character) {
  if (!character) throw new Error('角色信息缺失');

  const state = getAppState();
  const settings = state.get('settings') || {};

  const prompt = buildFirstMessagePrompt(character);
  const timeCtx = getTimeContext();

  const systemMessages = [];

  systemMessages.push(systemMsg(
    '你是一个角色扮演助手，只输出角色说的话，不要添加任何解释或前缀。',
    'roleplay',
    PRIORITY.IDENTITY
  ));

  const emotionPrompt = buildEmotionPrompt(character);
  if (emotionPrompt) {
    systemMessages.push(systemMsg(emotionPrompt, 'emotion', PRIORITY.EMOTION));
  }

  const bodyPrompt = buildBodyPrompt(character);
  if (bodyPrompt) {
    systemMessages.push(systemMsg(bodyPrompt, 'body', PRIORITY.BODY));
  }

  systemMessages.push(systemMsg(
    `【当前游戏时间】${timeCtx.gameTime.natural}\n${timeCtx.gameTime.description}`,
    'time',
    PRIORITY.TIME
  ));

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
    userMessage: prompt,
    summary: '',
    systemBudgetOverride,
  });

  const messagesForAPI = [
    ...budgetResult.systemKept.map(m => ({ role: 'system', content: m.content })),
    { role: 'user', content: prompt },
  ];

  const context = {
    character,
    emotionState: character.emotionState,
    bodyState: character.bodyState,
    user: {
      ...(settings.user || { name: '用户' }),
      message: prompt,
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
    console.warn('[FirstMessage] 注入器执行失败，使用降级方案:', e);
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

  try {
    let response = await sendChatRequest({
      messages: finalMessages,
      systemPrompt: fullSystem,
      temperature: 0.7,
      maxTokens: 400,
      stream: false,
    });

    let content = response.content?.trim();

    if (!content) {
      console.warn(
        '[FirstMessage] 首次生成返回空内容，尝试温和重试 ' +
        '(temperature 0.7 → 0.85, maxTokens 400 → 600)'
      );

      try {
        response = await sendChatRequest({
          messages: finalMessages,
          systemPrompt: fullSystem,
          temperature: 0.85,
          maxTokens: 600,
          stream: false,
        });
        content = response.content?.trim();

        if (!content) {
          console.warn('[FirstMessage] 重试后仍为空，使用预设开场白');
        }
      } catch (e) {
        console.warn('[FirstMessage] 重试失败:', e);
      }
    }

    return content || character.firstMessage || '你好，很高兴见到你。';
  } catch (error) {
    console.warn('动态开场白生成失败，使用预设开场白:', error);
    return character.firstMessage || '你好，很高兴见到你。';
  }
}

export async function ensureFirstMessage(character, convId) {
  if (!character || !convId) return false;
  if (character.generateFirstMessage === false) return false;

  if (pendingLocks.has(convId)) {
    return pendingLocks.get(convId);
  }

  const task = (async () => {
    try {
      const { getStores } = await import('../core/db.js');
      const stores = await getStores();
      const conv = await stores.conversations.get(convId);
      if (!conv || conv.messages.length > 0) return false;

      let firstMsg = character.firstMessage;
      if (character.generateFirstMessage) {
        try {
          const generated = await generateFirstMessage(character);
          if (generated && generated.length > 0) {
            firstMsg = generated;
          }
        } catch (e) {
          console.warn('动态开场白生成失败，使用预设:', e);
        }
      }

      if (firstMsg) {
        const convBeforeWrite = await stores.conversations.get(convId);
        if (convBeforeWrite && convBeforeWrite.messages.length > 0) {
          return false;
        }

        const msg = {
          id: generateUUID(),
          role: 'assistant',
          content: firstMsg,
          timestamp: getGameTime(),
        };
        await addMessageToConversation(convId, msg);
        return true;
      }
      return false;
    } finally {
      pendingLocks.delete(convId);
    }
  })();

  pendingLocks.set(convId, task);
  return task;
}