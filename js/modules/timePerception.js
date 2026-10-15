// js/modules/timePerception.js - 细腻时间感知（"过去多久" + 时段 + 反应档位）
//
// 本模块把"游戏时间戳 → 游戏时间戳"换算成自然语言的时间跨度描述，
// 并给出"反应档位（tier）"，供跨天感知 / 转场决策决定时间变换后的正确回应方式。
//
// 设计目标（对应用户诉求）：
//   1. 不只是"知道当前时间"，而是知道"过去多久了"
//   2. 知道对话发生在"什么时段"（深夜 / 清晨 / 傍晚…）
//   3. 时间变换后给出"正确的反应"（由 tier 驱动）

import { getGameTime } from './time.js';

// ============================================================
// 时段标签
// ============================================================

export function getPeriodLabel(ts) {
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
// 日期工具
// ============================================================

export function isSameGameDay(ts1, ts2) {
  const d1 = new Date(ts1);
  const d2 = new Date(ts2);
  return d1.getFullYear() === d2.getFullYear()
      && d1.getMonth() === d2.getMonth()
      && d1.getDate() === d2.getDate();
}

export function getCalendarDaysBetween(ts1, ts2) {
  const d1 = new Date(ts1);
  const d2 = new Date(ts2);
  d1.setHours(0, 0, 0, 0);
  d2.setHours(0, 0, 0, 0);
  return Math.round((d2 - d1) / (1000 * 60 * 60 * 24));
}

// ============================================================
// 反应档位（tier）：时间变换后"应该多强烈地反应"
// ============================================================

export const GAP_TIERS = {
  IMMEDIATE: 'immediate',                 // <30min：无需反应
  RECENT: 'recent',                       // 30min~2h：轻量"回来"招呼（活人感）
  SAME_DAY_LONG: 'sameday_long',          // 同日内 >2h：大半天没聊，新开场
  CROSS_DAY_YESTERDAY: 'crossday_yesterday', // 跨 1 天
  CROSS_DAY_RECENT: 'crossday_recent',    // 跨 2~6 天
  CROSS_DAY_OLD: 'crossday_old',          // 跨 >6 天
};

// ============================================================
// 核心：描述时间跨度
// ============================================================

/**
 * 描述两个游戏时间戳之间的跨度。
 *
 * @param {number} fromTs - 较早的时间戳（如上一句消息时间）
 * @param {number} [toTs] - 较晚的时间戳（默认取当前游戏时间）
 * @returns {{
 *   hoursSince: number,
 *   days: number,
 *   isCrossDay: boolean,
 *   fromPeriod: string,
 *   toPeriod: string,
 *   tier: string,
 *   spanText: string
 * }}
 */
export function describeTimeGap(fromTs, toTs = getGameTime()) {
  const hoursSince = (toTs - fromTs) / (1000 * 60 * 60);
  const days = getCalendarDaysBetween(fromTs, toTs);
  const isCrossDay = days >= 1;

  const fromPeriod = getPeriodLabel(fromTs);
  const toPeriod = getPeriodLabel(toTs);

  let tier;
  if (hoursSince < 0.5) tier = GAP_TIERS.IMMEDIATE;
  else if (hoursSince < 2) tier = GAP_TIERS.RECENT;
  else if (!isCrossDay) tier = GAP_TIERS.SAME_DAY_LONG;
  else if (days === 1) tier = GAP_TIERS.CROSS_DAY_YESTERDAY;
  else if (days <= 6) tier = GAP_TIERS.CROSS_DAY_RECENT;
  else tier = GAP_TIERS.CROSS_DAY_OLD;

  // 自然跨度描述
  let spanText;
  if (hoursSince < 1) {
    spanText = `约 ${Math.max(1, Math.round(hoursSince * 60))} 分钟前`;
  } else if (!isCrossDay) {
    spanText = `今天${fromPeriod}（约 ${Math.round(hoursSince)} 小时前）`;
  } else if (days === 1) {
    spanText = `昨天${fromPeriod}（约 ${Math.round(hoursSince)} 小时前）`;
  } else if (days <= 6) {
    spanText = `${days} 天前${fromPeriod}`;
  } else {
    spanText = `很久以前（约 ${days} 天前）`;
  }

  return {
    hoursSince,
    days,
    isCrossDay,
    fromPeriod,
    toPeriod,
    tier,
    spanText,
  };
}
