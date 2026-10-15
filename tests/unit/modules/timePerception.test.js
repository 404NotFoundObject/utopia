// 单元测试：timePerception.describeTimeGap
// 锁定"过去多久 + 时段 + 反应档位（tier）"的核心行为。
import { describe, it, expect } from 'vitest';
import { describeTimeGap, GAP_TIERS, getPeriodLabel } from '../../../js/modules/timePerception.js';

const H = 3600 * 1000;
const DAY = 24 * H;

// 锚点：2026-01-01 00:30（深夜）
const MIDNIGHT = new Date(2026, 0, 1, 0, 30, 0).getTime();

describe('describeTimeGap - 反应档位 tier', () => {
  it('<30min → IMMEDIATE（无需反应）', () => {
    const r = describeTimeGap(MIDNIGHT, MIDNIGHT + 20 * 60 * 1000);
    expect(r.tier).toBe(GAP_TIERS.IMMEDIATE);
    expect(r.isCrossDay).toBe(false);
  });

  it('30min~2h → RECENT（轻量招呼 / 活人感）', () => {
    const r = describeTimeGap(MIDNIGHT, MIDNIGHT + 1 * H);
    expect(r.tier).toBe(GAP_TIERS.RECENT);
    expect(r.hoursSince).toBeCloseTo(1, 5);
  });

  it('同日内 >2h → SAME_DAY_LONG', () => {
    const r = describeTimeGap(MIDNIGHT, MIDNIGHT + 8 * H); // 08:30 同日上午
    expect(r.tier).toBe(GAP_TIERS.SAME_DAY_LONG);
    expect(r.isCrossDay).toBe(false);
  });

  it('跨 1 天 → CROSS_DAY_YESTERDAY', () => {
    const r = describeTimeGap(MIDNIGHT, MIDNIGHT + 1 * DAY + 8 * H); // 次日 08:30
    expect(r.tier).toBe(GAP_TIERS.CROSS_DAY_YESTERDAY);
    expect(r.isCrossDay).toBe(true);
    expect(r.days).toBe(1);
  });

  it('跨 2~6 天 → CROSS_DAY_RECENT', () => {
    const r = describeTimeGap(MIDNIGHT, MIDNIGHT + 3 * DAY);
    expect(r.tier).toBe(GAP_TIERS.CROSS_DAY_RECENT);
    expect(r.days).toBe(3);
  });

  it('跨 >6 天 → CROSS_DAY_OLD', () => {
    const r = describeTimeGap(MIDNIGHT, MIDNIGHT + 10 * DAY);
    expect(r.tier).toBe(GAP_TIERS.CROSS_DAY_OLD);
    expect(r.days).toBe(10);
  });
});

describe('describeTimeGap - 时段变换意识', () => {
  it('深夜 → 上午：时段变化被识别', () => {
    // 00:30 深夜 → 当天 09:00 上午
    const r = describeTimeGap(MIDNIGHT, new Date(2026, 0, 1, 9, 0, 0).getTime());
    expect(r.fromPeriod).toBe('深夜');
    expect(r.toPeriod).toBe('上午');
    expect(r.fromPeriod).not.toBe(r.toPeriod);
  });

  it('同日内傍晚 → 深夜 短间隔：时段变化且为 RECENT', () => {
    // 22:00 夜晚 → 23:30 深夜（同日内 1.5h，未跨日历日）
    const r = describeTimeGap(new Date(2025, 11, 31, 22, 0, 0).getTime(), new Date(2025, 11, 31, 23, 30, 0).getTime());
    expect(r.fromPeriod).toBe('夜晚');
    expect(r.toPeriod).toBe('深夜');
    expect(r.fromPeriod).not.toBe(r.toPeriod);
    expect(r.isCrossDay).toBe(false);
    expect(r.tier).toBe(GAP_TIERS.RECENT);
  });

  it('同一上午内：时段不变', () => {
    const r = describeTimeGap(new Date(2026, 0, 1, 9, 0, 0).getTime(), new Date(2026, 0, 1, 11, 0, 0).getTime());
    expect(r.fromPeriod).toBe('上午');
    expect(r.toPeriod).toBe('上午');
  });
});

describe('describeTimeGap - spanText 自然语言', () => {
  it('分钟级', () => {
    const r = describeTimeGap(MIDNIGHT, MIDNIGHT + 45 * 60 * 1000);
    expect(r.spanText).toContain('分钟前');
  });

  it('同日小时级', () => {
    const r = describeTimeGap(MIDNIGHT, MIDNIGHT + 8 * H);
    expect(r.spanText).toContain('今天');
    expect(r.spanText).toContain('小时前');
  });

  it('跨 1 天', () => {
    const r = describeTimeGap(MIDNIGHT, MIDNIGHT + 1 * DAY + 8 * H);
    expect(r.spanText).toContain('昨天');
  });

  it('跨多天', () => {
    const r = describeTimeGap(MIDNIGHT, MIDNIGHT + 3 * DAY);
    expect(r.spanText).toContain('3 天前');
  });
});

describe('getPeriodLabel - 边界', () => {
  it('各时段边界正确', () => {
    expect(getPeriodLabel(new Date(2026, 0, 1, 6, 0, 0).getTime())).toBe('清晨');
    expect(getPeriodLabel(new Date(2026, 0, 1, 10, 0, 0).getTime())).toBe('上午');
    expect(getPeriodLabel(new Date(2026, 0, 1, 13, 0, 0).getTime())).toBe('中午');
    expect(getPeriodLabel(new Date(2026, 0, 1, 16, 0, 0).getTime())).toBe('下午');
    expect(getPeriodLabel(new Date(2026, 0, 1, 19, 0, 0).getTime())).toBe('傍晚');
    expect(getPeriodLabel(new Date(2026, 0, 1, 21, 0, 0).getTime())).toBe('夜晚');
    expect(getPeriodLabel(new Date(2026, 0, 1, 2, 0, 0).getTime())).toBe('深夜');
  });
});
