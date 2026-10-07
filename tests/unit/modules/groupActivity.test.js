import { describe, it, expect } from 'vitest';
import { calculateActiveLevel } from '../../../js/modules/groupActivity.js';

describe('modules/groupActivity#calculateActiveLevel', () => {
  const MIN = 60 * 1000;
  // 未初始化 time 模块时，getGameTime() 回退为 Date.now()，
  // 因此这里直接用真实时间戳构造成员的 lastActiveAt（游戏时间域在未推进时 ≈ 真实时间）。
  const now = Date.now();

  function member(lastActiveAt) {
    return lastActiveAt === null ? {} : { lastActiveAt };
  }

  it('空成员返回「正常」', () => {
    expect(calculateActiveLevel([])).toBe('正常');
    expect(calculateActiveLevel(null)).toBe('正常');
  });

  it('全部成员近 5 分钟内活跃 → 活跃', () => {
    const members = [
      member(now - 1 * MIN),
      member(now - 2 * MIN),
      member(now - 3 * MIN),
    ];
    expect(calculateActiveLevel(members)).toBe('活跃');
  });

  it('全部成员久未活跃 → 冷清', () => {
    const members = [
      member(now - 60 * MIN),
      member(now - 61 * MIN),
    ];
    expect(calculateActiveLevel(members)).toBe('冷清');
  });

  it('成员缺 lastActiveAt 时视为久未活跃', () => {
    const members = [
      member(now - 1 * MIN),
      member(null),
      member(null),
    ];
    // 1 活跃 / 3 成员 ≈ 0.33 → 低活跃
    expect(calculateActiveLevel(members)).toBe('低活跃');
  });

  it('活跃比例在 0.4~0.7 之间 → 正常', () => {
    // 2 活跃 / 4 成员 = 0.5
    const members = [
      member(now - 1 * MIN),
      member(now - 2 * MIN),
      member(now - 60 * MIN),
      member(now - 60 * MIN),
    ];
    expect(calculateActiveLevel(members)).toBe('正常');
  });

  it('活跃比例在 0.2~0.4 之间 → 低活跃', () => {
    // 1 活跃 / 4 成员 = 0.25
    const members = [
      member(now - 1 * MIN),
      member(now - 60 * MIN),
      member(now - 60 * MIN),
      member(now - 60 * MIN),
    ];
    expect(calculateActiveLevel(members)).toBe('低活跃');
  });
});
