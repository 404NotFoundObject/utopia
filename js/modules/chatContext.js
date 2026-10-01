// js/modules/chatContext.js - 共享聊天上下文构建层
//
// 审计 P1-6 修复：此前「单聊 / 群聊 / 通话 / 自主对话」四处各自重建提示词管线，
// 导致世界书预算、applyInjection、降级方案四处逐字重复，且情感/身体状态只在单聊闭环。
// 本模块抽取三条共享路径，作为后续所有同类分叉的孵化器：
//
//   1. buildChatContext   —— 统一 context 对象（角色/情感/身体/用户/时间上下文）
//   2. buildFinalMessages —— 预算计算 + fitContextByBudget + applyInjection + 统一降级
//   3. applyEngineEffects —— 情感/身体状态更新（原只在单聊执行，现可被各管线复用）
//
// 设计原则：只新增、不删减既有行为；所有差异点通过 extra 参数与前置 systemMessages
// 注入，而非在共享层写 scene 分支。

import { getAppState } from '../core/state.js';
import { getStores } from '../core/db.js';
import { getTimeContext, getGameTime } from './time.js';
import { applyInjection } from './injector.js';
import { classifyUserMessage, handleInteraction } from './emotionEngine.js';
import { handleBodyEvent } from './bodyState.js';
import { checkAndApplyInjury } from './injuryEngine.js';
import {
  fitContextByBudget,
  computeBudget,
  getWorldBookBudgetRatio,
} from './tokenBudget.js';

/**
 * 构建统一的注入上下文对象。
 * 各处管线原先手工拼接的 character/emotionState/bodyState/user/conversation/time 字段在此归一。
 *
 * @param {object} opts
 * @param {object} opts.character  当前角色（含 emotionState/bodyState）
 * @param {string} opts.userMessage  用户本轮输入（可为空字符串）
 * @param {object|null} opts.conversation  对话对象（可为 null）
 * @param {object} [opts.extra]  附加字段（如群聊 group 信息、通话 call 信息）
 * @returns {object} 统一 context
 */
export function buildChatContext({ character, userMessage = '', conversation = null, extra = {} }) {
  const state = getAppState();
  const settings = state.get('settings') || {};
  const timeCtx = getTimeContext();

  return {
    character,
    emotionState: character.emotionState,
    bodyState: character.bodyState,
    user: {
      ...(settings.user || { name: '用户' }),
      message: userMessage || '',
    },
    conversation,
    ...timeCtx,
    ...extra,
  };
}

/**
 * 计算世界书预算与系统预算覆盖量。四处管线原先逐字重复的计算在此归一。
 *
 * @param {string} modelName
 * @param {object} settings
 * @returns {{ worldBookBudget: number, systemBudgetOverride: number|undefined }}
 */
export function computeWorldBookBudgets(modelName, settings) {
  const tbEnabled = settings.tokenBudget?.enabled !== false;
  const wbBudgetRatio = getWorldBookBudgetRatio();
  const rawBudget = computeBudget(modelName);
  const rawSystemBudget = rawBudget.breakdown.system;
  const worldBookBudget = Math.floor(rawSystemBudget * wbBudgetRatio);
  const systemBudgetOverride = tbEnabled ? rawSystemBudget - worldBookBudget : undefined;
  return { worldBookBudget, systemBudgetOverride };
}

/**
 * 构建最终发送给模型的消息（含注入与统一降级）。
 * 返回两种形态：chat.js 用 preserveSystem（system 保留在 messages 内），
 * 通话/自主/群聊用 splitSystem（system 拆出作为 systemPrompt 单独传）。
 *
 * @param {object} opts
 * @param {object[]} opts.systemMessages  含 tag/priority 的系统消息数组
 * @param {object[]} opts.historyMessages  历史消息 [{role, content}]
 * @param {string} opts.userMessage  用户本轮输入
 * @param {string} opts.summary  摘要文本
 * @param {string} opts.modelName
 * @param {object} opts.settings
 * @param {object} opts.character
 * @param {object} opts.context  由 buildChatContext 产出
 * @param {'preserve'|'split'} [opts.mode]  系统消息形态，默认 'preserve'
 * @param {string} [opts.trailingUserMessage]  追加到 messagesForAPI 末尾的用户消息（如主动指令）
 * @param {object} [opts.extra]  附加传给 fitContextByBudget 的字段
 * @returns {Promise<{finalMessages: object[], fullSystem: string, worldBookBudget: number, budgetStats: object}>}
 */
export async function buildFinalMessages({
  systemMessages,
  historyMessages,
  userMessage,
  summary = '',
  modelName,
  settings,
  character,
  context,
  mode = 'preserve',
  trailingUserMessage = null,
  extra = {},
}) {
  const { worldBookBudget, systemBudgetOverride } = computeWorldBookBudgets(modelName, settings);

  const budgetResult = fitContextByBudget({
    modelName,
    systemMessages,
    historyMessages,
    userMessage,
    summary,
    systemBudgetOverride,
    ...extra,
  });

  const messagesForAPI = [
    ...budgetResult.systemKept.map(m => ({ role: 'system', content: m.content })),
    ...budgetResult.historyKept,
    ...(trailingUserMessage ? [{ role: 'user', content: trailingUserMessage }] : []),
  ];

  let finalMessages = [];
  let fullSystem = '';

  try {
    const result = await applyInjection(messagesForAPI, context, { worldBookBudget });
    if (mode === 'split') {
      fullSystem = result
        .filter(msg => msg.role === 'system')
        .map(msg => msg.content)
        .join('\n\n');
      finalMessages = result.filter(msg => msg.role !== 'system');
    } else {
      finalMessages = result;
    }
  } catch (e) {
    console.warn('[ChatContext] 注入器执行失败，使用降级方案:', e);
    const degradedSystemMsgs = messagesForAPI
      .filter(msg => msg.role === 'system')
      .map(msg => msg.content)
      .filter(c => c && c.trim());
    const degradedSystem = [
      character.systemPrompt || '',
      ...degradedSystemMsgs,
    ]
      .filter(Boolean)
      .join('\n\n');

    if (mode === 'split') {
      fullSystem = degradedSystem;
      finalMessages = messagesForAPI.filter(msg => msg.role !== 'system');
    } else {
      finalMessages = [
        ...(degradedSystem ? [{ role: 'system', content: degradedSystem }] : []),
        ...messagesForAPI.filter(msg => msg.role !== 'system'),
      ];
    }
  }

  return { finalMessages, fullSystem, worldBookBudget, budgetStats: budgetResult.stats };
}

/**
 * 情感/身体状态更新（审计 P1-6 核心修复）。
 * 原逻辑只在 chat.js 单聊路径执行；通话、自主对话、群聊、朋友圈均只读取不更新，
 * 导致角色在其它交互路径上的情感完全不动。此函数把这段更新抽为可复用单元。
 *
 * @param {object} opts
 * @param {object} opts.character  角色对象（会被重新从 state 刷新）
 * @param {string} opts.userMessage  用于情感分类与受伤判断的输入
 * @param {boolean} [opts.updateEmotion=true]  是否更新情感状态
 * @param {boolean} [opts.updateBody=true]  是否更新身体状态
 * @param {boolean} [opts.checkInjury=true]  是否做受伤检查
 * @returns {Promise<object>} 更新后的角色对象
 */
export async function applyEngineEffects({
  character,
  userMessage,
  updateEmotion = true,
  updateBody = true,
  checkInjury = true,
}) {
  const state = getAppState();
  const text = (userMessage || '').trim();
  let current = character;

  const refreshCharacter = async () => {
    const appState = getAppState();
    const charList = appState.get('characters') || [];
    const latest = charList.find(c => c.id === current.id);
    if (latest) current = latest;
  };

  if (!text) return current;

  if (updateEmotion) {
    const analysis = await classifyUserMessage(text);
    if (analysis.type !== 'neutral') {
      await handleInteraction(current, analysis.type, analysis.intensity);
    }

    // 情绪事件 → 体感事件（与 chat.js 原映射保持一致）
    if (updateBody) {
      const bodyEventMap = {
        'praise': 'praise',
        'criticism': 'criticism',
        'care': 'care',
        'funny': 'funny',
        'intimate': 'intimate',
        'neglect': 'neglect',
        'gratitude': 'care',
        'reassurance': 'care',
        'teasing': 'funny',
        'rejection': 'criticism',
      };
      if (bodyEventMap[analysis.type]) {
        await handleBodyEvent(current, bodyEventMap[analysis.type], analysis.intensity);
      }
    }
  }

  if (checkInjury) {
    try {
      const injured = await checkAndApplyInjury(current, text);
      if (injured) {
        await refreshCharacter();
      }
    } catch (e) {
      console.warn('[ChatContext] 受伤检查失败:', e);
    }
  }

  await refreshCharacter();
  return current;
}

// 重新导出供调用方减少 import 数量
export { systemMsg, PRIORITY, formatBudgetReport } from './tokenBudget.js';

/**
 * 朋友圈回流（审计 P2-7）：构建「朋友圈动态」系统提示，让角色在聊天时能看到好友近期的动态与评论。
 * 原实现无任何代码读取 posts store，AI 社交是单向的（角色 A 发帖、B 评论，但 A 看不到 B 的评论）。
 *
 * 规则：
 *  - 只取最近 24 小时（游戏时间）内的动态
 *  - 排除当前角色自己发的动态（自己的动态不需要「回流」提醒）
 *  - 优先保留有评论的动态（评论是社交互动的核心信号）
 *  - 最多取 5 条，避免占用过多 token
 *
 * @param {object} character 当前聊天角色
 * @returns {Promise<string>} 拼好的系统提示文本，无动态时返回空字符串
 */
export async function buildSocialContext(character) {
  try {
    const stores = await getStores();
    if (!stores.posts) return '';

    const allPosts = await stores.posts.getAll();
    if (!Array.isArray(allPosts) || allPosts.length === 0) return '';

    const now = getGameTime();
    const WINDOW_MS = 24 * 60 * 60 * 1000;

    const relevant = allPosts
      .filter(p => p && p.authorId !== character.id)
      .filter(p => p.timestamp && (now - p.timestamp) >= 0 && (now - p.timestamp) <= WINDOW_MS)
      .sort((a, b) => {
        // 有评论的优先，其次按时间倒序
        const aHas = Array.isArray(a.comments) && a.comments.length > 0;
        const bHas = Array.isArray(b.comments) && b.comments.length > 0;
        if (aHas !== bHas) return aHas ? -1 : 1;
        return (b.timestamp || 0) - (a.timestamp || 0);
      })
      .slice(0, 5);

    if (relevant.length === 0) return '';

    // 批量解析作者名（一次读全部角色，避免逐条 await）
    const nameMap = {};
    try {
      const allChars = await stores.characters.getAll();
      for (const c of allChars) {
        if (c && c.id && c.name) nameMap[c.id] = c.name;
      }
    } catch (_) {}

    const lines = relevant.map((post, idx) => {
      const authorName = nameMap[post.authorId] || '好友';
      const content = (post.content || '').slice(0, 80);
      let commentText = '';
      if (Array.isArray(post.comments) && post.comments.length > 0) {
        const names = post.comments
          .map(c => (c && c.content ? c.content : ''))
          .filter(Boolean)
          .slice(0, 3);
        if (names.length > 0) {
          commentText = ` 有好友评论：${names.map(n => `“${n.slice(0, 30)}”`).join('、')}`;
        }
      }
      return `[${idx + 1}] ${authorName}的动态：${content}${commentText}`;
    });

    return `【朋友圈动态】你最近看到好友们发了这些动态，可以在闲聊中自然地提及或回应：\n${lines.join('\n')}`;
  } catch (e) {
    console.warn('[ChatContext] 朋友圈上下文构建失败:', e);
    return '';
  }
}
