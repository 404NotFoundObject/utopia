// js/modules/crossDayAwareness.js - 跨天感知（事实维度）
//
//   本文件用 `getGameTime()` 作为 now，读 `lastMsg.timestamp` 作为 lastTime。
//   由于消息 timestamp 已在 chat.js / firstMessage.js / voiceCallUI.js 统一为
//   getGameTime()，两者相减即为游戏时间间隔，语义正确。
//
// 职责：
//   1. 判断是否跨天，跨了几天
//   2. 生成"事实性"提示词（几点、几天、是否中断）
//   3. 与冷落感知（情感维度）互补而非冲突
//
// 设计原则：
//   - 跨天感知只给事实，语气交给冷落感知
//   - 中断提醒由 conversationState 的 phase 提供
//   - 单聊完整版，群聊简化版

import { getGameTime } from './time.js';
import { getConversationPhase, PHASE, COMPLETENESS } from './conversationState.js';

// ============================================================
// 时间工具
// ============================================================

export function isDifferentGameDay(ts1, ts2) {
  const d1 = new Date(ts1);
  const d2 = new Date(ts2);
  return d1.getFullYear() !== d2.getFullYear()
      || d1.getMonth() !== d2.getMonth()
      || d1.getDate() !== d2.getDate();
}

export function getDaysBetween(ts1, ts2) {
  const d1 = new Date(ts1);
  const d2 = new Date(ts2);
  d1.setHours(0, 0, 0, 0);
  d2.setHours(0, 0, 0, 0);
  return Math.round((d2 - d1) / (1000 * 60 * 60 * 24));
}

export function formatGameTimestamp(ts) {
  const d = new Date(ts);
  const pad = n => String(n).padStart(2, '0');
  return `${d.getMonth() + 1}月${d.getDate()}日 ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function getTimePeriodLabel(ts) {
  const d = new Date(ts);
  const h = d.getHours();
  if (h >= 5 && h < 8) return '清晨';
  if (h >= 8 && h < 12) return '上午';
  if (h >= 12 && h < 14) return '中午';
  if (h >= 14 && h < 18) return '下午';
  if (h >= 18 && h < 20) return '傍晚';
  if (h >= 20 && h < 23) return '夜晚';
  return '深夜';
}

// ============================================================
// 核心：生成跨天提示词
// ============================================================

export function buildCrossDayPrompt(conv, character, options = {}) {
  const { scene = 'chat' } = options;

  if (scene === 'group') {
    return buildGroupCrossDayPrompt(conv, options);
  }

  const phase = getConversationPhase(conv);

  if (phase.phase === PHASE.EMPTY || phase.phase === PHASE.ACTIVE) {
    return '';
  }

  const messages = (conv.messages || []).filter(m => m.role === 'user' || m.role === 'assistant');
  if (messages.length === 0) return '';

  const lastMsg = messages[messages.length - 1];
  const lastTime = lastMsg.timestamp || getGameTime();
  const now = getGameTime();

  const days = getDaysBetween(lastTime, now);
  const hours = phase.hoursSince;

  let timeDesc;
  if (days === 0) {
    timeDesc = `${Math.round(hours)} 小时前`;
  } else if (days === 1) {
    timeDesc = `昨天 ${getTimePeriodLabel(lastTime)}（${formatGameTimestamp(lastTime)}）`;
  } else {
    timeDesc = `${days} 天前（${formatGameTimestamp(lastTime)}）`;
  }

  const parts = [];

  parts.push(`【跨天感知】你们上次对话发生在${timeDesc}。`);

  if (phase.phase === PHASE.INTERRUPTED && phase.completeness === COMPLETENESS.INCOMPLETE) {
    const preview = phase.lastMessagePreview;
    if (lastMsg.role === 'user') {
      parts.push(`用户上次话说到一半（"${preview}"）就离开了。请自然地在回复中提及这一点——例如"昨天/上次你说的那句话还没说完呢"。`);
    } else if (lastMsg.role === 'assistant') {
      parts.push(`你上次的回复被中断了。请在回复中自然延续。`);
    }
  } else if (phase.phase === PHASE.ENDED) {
    parts.push(`上次对话是自然结束的。请不要刻意提及"上次聊到哪"，像正常人一样开场即可。`);
  } else {
    parts.push(`上次对话没有明确结束。请自然接续，不需要刻意提及时间跨度。`);
  }

  if (scene === 'proactive') {
    parts.push(`（你是主动发起的一方，语气应自然、期待，而不是抱怨或讽刺。）`);
  }

  return parts.join('\n');
}

function buildGroupCrossDayPrompt(conv, options) {
  const messages = (conv.messages || []).filter(m => m.role === 'user' || m.role === 'assistant');
  if (messages.length === 0) return '';

  const lastMsg = messages[messages.length - 1];
  const lastTime = lastMsg.timestamp || getGameTime();
  const now = getGameTime();

  const days = getDaysBetween(lastTime, now);
  const hours = (now - lastTime) / (1000 * 60 * 60);

  if (hours < 2) return '';

  if (days === 0) {
    return `【跨天感知】群聊最后活跃是 ${Math.round(hours)} 小时前。不需要刻意提及时间跨度，自然接续即可。`;
  } else if (days === 1) {
    return `【跨天感知】群聊最后活跃是昨天 ${getTimePeriodLabel(lastTime)}。今天是新的一天，可以自然切换到新的语境。`;
  } else {
    return `【跨天感知】群聊最后活跃是 ${days} 天前。请自然接续，不要刻意提起旧话题。`;
  }
}

// ============================================================
// 与冷落感知的分工说明（供调试用）
// ============================================================

export function describeCrossDayAndCold(conv, coldPrompt) {
  const phase = getConversationPhase(conv);
  return {
    crossDay: {
      phase: phase.phase,
      days: Math.floor(phase.daysSince),
      hours: phase.hoursSince.toFixed(2),
      completeness: phase.completeness,
      willInject: ![PHASE.EMPTY, PHASE.ACTIVE].includes(phase.phase),
    },
    cold: {
      willInject: !!coldPrompt,
      preview: coldPrompt ? coldPrompt.slice(0, 100) : '',
    },
  };
}

// ============================================================
// 便捷入口
// ============================================================

export function analyzeCrossDay(conv, character, options = {}) {
  const prompt = buildCrossDayPrompt(conv, character, options);
  const phase = getConversationPhase(conv);

  return {
    prompt,
    phase: phase.phase,
    days: Math.floor(phase.daysSince),
    hours: phase.hoursSince,
    isCrossDay: phase.daysSince >= 1,
    isInterrupted: phase.phase === PHASE.INTERRUPTED,
  };
}