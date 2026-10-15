// js/modules/crossDayAwareness.js - 跨天 / 时间变换感知（事实维度 + 细腻时间感知）
//
//   本文件用 `getGameTime()` 作为 now，读 `lastMsg.timestamp` 作为 lastTime。
//   由于消息 timestamp 已在 chat.js / firstMessage.js / voiceCallUI.js 统一为
//   getGameTime()，两者相减即为游戏时间间隔，语义正确。
//
// 职责：
//   1. 判断是否跨天，跨了几天
//   2. 用 timePerception 给出"过去多久 + 时段 + 反应档位（tier）"的细腻描述
//   3. 生成"事实性 + 时间变换反应"提示词（几点、隔了多久、时段怎么变的、该怎么反应）
//   4. 与冷落感知（情感维度）互补而非冲突
//
// 设计原则：
//   - 跨天感知只给事实与时间变换后的正确反应方向，语气交给冷落感知
//   - 中断提醒由 conversationState 的 phase 提供
//   - 单聊完整版，群聊简化版

import { getGameTime } from './time.js';
import { getConversationPhase, PHASE, COMPLETENESS } from './conversationState.js';
import {
  describeTimeGap,
  getPeriodLabel,
  getCalendarDaysBetween,
  isSameGameDay,
  GAP_TIERS,
} from './timePerception.js';

// 兼容旧导出（历史上曾独立实现，现委托给 timePerception 单一来源）
export function isDifferentGameDay(ts1, ts2) { return !isSameGameDay(ts1, ts2); }
export function getDaysBetween(ts1, ts2) { return getCalendarDaysBetween(ts1, ts2); }

// 仅用于展示的时间戳格式化（timePerception 不负责展示层）
export function formatGameTimestamp(ts) {
  const d = new Date(ts);
  const pad = n => String(n).padStart(2, '0');
  return `${d.getMonth() + 1}月${d.getDate()}日 ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// ============================================================
// 时段变换 / 反应档位 → 自然语言
// ============================================================

/**
 * 时段是否变化 + 一句话时段描述。
 * 例：from=深夜 / to=上午 → "你上次是深夜找我的，现在都上午了"
 *     from=上午 / to=上午 → "你上次是上午找我的"
 */
function buildPeriodNote(gap) {
  const periodChanged = gap.fromPeriod !== gap.toPeriod;
  const periodText = periodChanged
    ? `你上次是${gap.fromPeriod}找我的，现在都${gap.toPeriod}了`
    : `你上次是${gap.fromPeriod}找我的`;
  return { periodChanged, periodText };
}

/**
 * 反应档位（tier）→ 时间变换后的"正确反应"方向。
 * 对应 timePerception.GAP_TIERS，分层给出活人感与转场力度。
 */
function buildTierReaction(gap) {
  switch (gap.tier) {
    case GAP_TIERS.RECENT: // 30min~2h：轻量招呼，制造活人感
      return '这么快又回来啦，可以自然地打个招呼或接一句"刚忙完？/回来啦"。';
    case GAP_TIERS.SAME_DAY_LONG: // 同日内 >2h：大半天没聊，新开场
      return '今天已经是大半天没聊了，这是一次新的对话开场，自然地问候或开启新话题，不必硬接上一句话的尾巴。';
    case GAP_TIERS.CROSS_DAY_YESTERDAY: // 跨 1 天
      return '已经跨天（隔了一晚），这是新的一天、新的开场，自然地问候或开启新话题，不必硬接上一句话的尾巴。';
    case GAP_TIERS.CROSS_DAY_RECENT: // 跨 2~6 天
      return '已经好几天没见了，自然地打个招呼、关心一下近况，再开启新话题。';
    case GAP_TIERS.CROSS_DAY_OLD: // 跨 >6 天
      return '真是好久不见了，自然地表达想念或小小的惊喜，再自然地开启新话题。';
    default:
      return '自然地开启新话题或问候即可，不必硬接上一句。';
  }
}

/**
 * 把"时间跨度 + 时段变换 + 反应档位"组装成一条时间变换提示。
 * 关键词"新的对话开场 / 不必硬接 / 开启新话题"必须保留（回归测试依赖）。
 */
function buildTimeChangePrompt(gap) {
  const { periodText } = buildPeriodNote(gap);
  const reaction = buildTierReaction(gap);
  return `【时间感知·转场】你们上次对话发生在${gap.spanText}。${periodText}。${reaction}`;
}

// ============================================================
// 核心：生成跨天 / 时间变换提示词
// ============================================================

export function buildCrossDayPrompt(conv, character, options = {}) {
  const { scene = 'chat' } = options;

  if (scene === 'group') {
    return buildGroupCrossDayPrompt(conv, options);
  }

  const phase = getConversationPhase(conv);

  if (phase.phase === PHASE.EMPTY) return '';

  const messages = (conv.messages || []).filter(m => m.role === 'user' || m.role === 'assistant');
  if (messages.length === 0) return '';

  const lastMsg = messages[messages.length - 1];
  const lastTime = lastMsg.timestamp || getGameTime();
  const now = getGameTime();
  const gap = describeTimeGap(lastTime, now);

  const parts = [];

  // ---------- ACTIVE：近时对话 ----------
  // 即便"进行中"，离开一阵（>=30 分钟）也该有点时间意识 —— 活人感。
  // 用户反馈：间隔一小时也该知道"过去多久了"，而不是无缝续话题。
  if (phase.phase === PHASE.ACTIVE) {
    if (gap.hoursSince < 0.5) return '';
    const mins = Math.max(1, Math.round(gap.hoursSince * 60));
    return `【时间感知】你和用户的上一句对话是约 ${mins} 分钟前（从${gap.fromPeriod}到现在${gap.toPeriod}）。可以自然地打个招呼或随口问一句"回来啦 / 刚在忙什么"，不要生硬地接续上一句话的尾巴。`;
  }

  // ---------- INTERRUPTED：用户半截话 / 助手回复被中断 ----------
  if (phase.phase === PHASE.INTERRUPTED) {
    const preview = phase.lastMessagePreview;
    const { periodText } = buildPeriodNote(gap);
    if (lastMsg.role === 'user') {
      parts.push(`【中断感知】用户上次话说到一半（"${preview}"）就离开了（${periodText}）。请自然地在回复中提及这一点——例如"昨天/上次你说的那句话还没说完呢"。`);
    } else {
      parts.push(`【中断感知】你上次的回复被中断了（${periodText}）。请在回复中自然延续，并自然地开启新话题。`);
    }
    // 跨天 / 长时间：补充"时间变换后的正确反应"
    parts.push(buildTimeChangePrompt(gap));
  } else if (phase.phase === PHASE.ENDED || phase.phase === PHASE.PAUSED) {
    // ---------- ENDED / PAUSED：自然结束 / 没有明确结束 ----------
    // 跨天或长时间间隔都该"新开场 + 时间变换反应"，而不是硬接上一句。
    parts.push(buildTimeChangePrompt(gap));
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
  const gap = describeTimeGap(lastTime);

  if (gap.hoursSince < 2) return '';

  if (!gap.isCrossDay) {
    return `【跨天感知】群聊最后活跃是${gap.spanText}。不需要刻意提及时间跨度，自然接续即可。`;
  }

  const dayText = gap.days === 1 ? '昨天' : `${gap.days} 天前`;
  return `【跨天感知】群聊最后活跃是${dayText}${gap.fromPeriod}（现在${gap.toPeriod}）。今天是新的一天，可以自然切换到新的语境，不必硬接旧话题。`;
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

  // 日数用与提示词一致的日历日计算（避免 daysSince 因毫秒误差少算一天）
  const messages = (conv.messages || []).filter(m => m.role === 'user' || m.role === 'assistant');
  let days = Math.floor(phase.daysSince);
  if (messages.length > 0) {
    const lastMsg = messages[messages.length - 1];
    const lastTime = lastMsg.timestamp || getGameTime();
    days = getCalendarDaysBetween(lastTime, getGameTime());
  }

  return {
    prompt,
    phase: phase.phase,
    days,
    hours: phase.hoursSince,
    isCrossDay: phase.daysSince >= 1,
    isInterrupted: phase.phase === PHASE.INTERRUPTED,
  };
}
