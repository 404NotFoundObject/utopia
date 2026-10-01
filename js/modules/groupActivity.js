// js/modules/groupActivity.js - 群活跃度计算（共享工具）
//
// 审计 P3-5：`calculateActiveLevel` 原在 groupChat.js 与 groupChatEngine.js
// 各有一份逐字相同的拷贝，已漂移隐患（引擎侧改用真实时间戳后两处判定口径
// 需保持一致）。这里抽取为单一实现，两处统一引用。

import { getGameTime } from './time.js';

const ACTIVE_THRESHOLD_MS = 5 * 60 * 1000; // 5 分钟内有发言视为「活跃」

/**
 * 计算群活跃度等级。
 *
 * 注：此处统一使用「游戏时间域」——`getGameTime()` 作为 now，成员的游戏时间
 * 戳 `lastActiveAt` 作为最后活跃时间。与 groupChatEngine 里自动发言概率所用的
 * 「真实时间域」（Date.now / lastActiveAtReal）是两套不同的口径，勿混用。
 *
 * @param {Array<{lastActiveAt?:number}>} members - 群成员列表
 * @returns {'活跃'|'正常'|'低活跃'|'冷清'}
 */
export function calculateActiveLevel(members) {
  if (!members || members.length === 0) return '正常';

  const now = getGameTime();
  const activeCount = members.filter(m => {
    const lastActive = m.lastActiveAt || 0;
    return now - lastActive < ACTIVE_THRESHOLD_MS;
  }).length;

  const ratio = activeCount / members.length;
  if (ratio > 0.7) return '活跃';
  if (ratio > 0.4) return '正常';
  if (ratio > 0.2) return '低活跃';
  return '冷清';
}
