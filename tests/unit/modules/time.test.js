import { describe, it, expect } from 'vitest';
import { computeSegmentedAdvance } from '../../../js/modules/time.js';

describe('modules/time#computeSegmentedAdvance', () => {
  const HOUR = 60 * 60 * 1000;

  it('无速度变更时，等于 时长 × 当前速度', () => {
    // 3 小时 × 48x = 144 小时
    expect(computeSegmentedAdvance(0, 3 * HOUR, [], 48)).toBe(144 * HOUR);
  });

  it('有速度变更时，按变更点分段积分', () => {
    // from 0 到 4h，其中第 2h 时速度从 1x 改为 48x
    const speedHistory = [{ speed: 48, at: 2 * HOUR }];
    // 前 2h × 1x + 后 2h × 48x = 2h + 96h = 98h
    expect(computeSegmentedAdvance(0, 4 * HOUR, speedHistory, 1)).toBe(98 * HOUR);
  });

  it('多次速度变更按时间升序逐段累加', () => {
    // 0-1h: 1x, 1h-3h: 8x, 3h-5h: 48x
    const speedHistory = [
      { speed: 48, at: 3 * HOUR },
      { speed: 8, at: 1 * HOUR },
    ];
    // 1h*1 + 2h*8 + 2h*48 = 1 + 16 + 96 = 113h
    expect(computeSegmentedAdvance(0, 5 * HOUR, speedHistory, 1)).toBe(113 * HOUR);
  });

  it('忽略区间外与边界外的变更点', () => {
    // at <= from 或 at > to 的变更点不影响积分
    const speedHistory = [
      { speed: 48, at: 0 },            // at === from → 忽略
      { speed: 48, at: 10 * HOUR },    // at > to → 忽略
      { speed: 8, at: 2 * HOUR },      // 落在区间内 → 生效
    ];
    // 0-2h: 1x, 2-4h: 8x = 2 + 16 = 18h
    expect(computeSegmentedAdvance(0, 4 * HOUR, speedHistory, 1)).toBe(18 * HOUR);
  });

  it('时长非正时返回 0', () => {
    expect(computeSegmentedAdvance(5, 5, [], 48)).toBe(0);
    expect(computeSegmentedAdvance(5, 4, [], 48)).toBe(0);
  });

  it('容忍 null/undefined 的历史与缺失 speed', () => {
    expect(computeSegmentedAdvance(0, HOUR, null, 48)).toBe(48 * HOUR);
    expect(computeSegmentedAdvance(0, HOUR, undefined, 48)).toBe(48 * HOUR);
    // 变更点缺 speed 字段时按 1x 兜底（不抛错、不 NaN）
    expect(computeSegmentedAdvance(0, 2 * HOUR, [{ at: 1 * HOUR }], 1)).toBe(2 * HOUR);
  });

  it('典型场景：关闭时 1x，离线期间改 48x 后不再整段按 48x 推进', () => {
    // 关闭 3 天后重开，第 2 天时用户把倍速改成了 48x
    const day = 24 * HOUR;
    const speedHistory = [{ speed: 48, at: 2 * day }];
    const gameAdvance = computeSegmentedAdvance(0, 3 * day, speedHistory, 1);
    // 前 2 天 1x + 后 1 天 48x = 2 + 48 = 50 天
    expect(gameAdvance).toBe(50 * day);
    // 旧实现会得到 3 天 × 48x = 144 天，显著高估
    expect(gameAdvance).toBeLessThan(3 * day * 48);
  });
});
