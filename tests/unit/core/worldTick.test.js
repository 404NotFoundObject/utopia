import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  HEARTBEAT_MS,
  registerWorldTask,
  startWorldTick,
  stopWorldTick,
  resetWorldTasks,
  getWorldTaskSnapshot,
} from '../../../js/core/worldTick.js';

/**
 * 统一心跳的到期判定与后台补偿。
 *
 * 原先三条 setInterval 在 `document.hidden` 时 return 却**不顺延**，切回
 * 前台要等满一个周期才恢复执行（character 滞后 60s、social 滞后 600s）。
 * 这里锁住「后台只走时间、回前台立刻补跑」这条新语义。
 */
describe('worldTick 统一心跳', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resetWorldTasks();
    stopWorldTick();
    setHidden(false);
  });

  afterEach(() => {
    stopWorldTick();
    resetWorldTasks();
    vi.useRealTimers();
    setHidden(false);
  });

  function setHidden(value) {
    Object.defineProperty(document, 'hidden', { value, configurable: true });
  }

  /** 推进虚拟时间并冲刷 Promise 回调（任务体走 Promise.resolve().then） */
  async function advance(ms) {
    await vi.advanceTimersByTimeAsync(ms);
  }

  test('未到期不执行，满一个间隔才执行', async () => {
    const fn = vi.fn();
    registerWorldTask('t', fn, 60_000);
    startWorldTick();

    await advance(HEARTBEAT_MS * 10);
    expect(fn).not.toHaveBeenCalled();

    await advance(60_000);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  test('前台按各自周期重复执行，互不干扰', async () => {
    const fast = vi.fn();
    const slow = vi.fn();
    registerWorldTask('fast', fast, 10_000);
    registerWorldTask('slow', slow, 50_000);
    startWorldTick();

    await advance(50_000);
    expect(fast).toHaveBeenCalledTimes(5);
    expect(slow).toHaveBeenCalledTimes(1);
  });

  test('后台期间不执行任务', async () => {
    const fn = vi.fn();
    registerWorldTask('t', fn, 60_000);
    startWorldTick();

    await advance(60_000);
    expect(fn).toHaveBeenCalledTimes(1);

    setHidden(true);
    await advance(600_000);
    expect(fn, '隐藏页不应执行').toHaveBeenCalledTimes(1);
  });

  test('切回前台立刻补跑逾期任务（消除滞后）', async () => {
    const fn = vi.fn();
    registerWorldTask('t', fn, 60_000);
    startWorldTick();

    await advance(60_000);
    expect(fn).toHaveBeenCalledTimes(1);

    // 后台十分钟：期间本该跑十次，全部跳过
    setHidden(true);
    await advance(600_000);
    expect(fn).toHaveBeenCalledTimes(1);

    // 回到前台：逾期 → 立即补跑，不必再等满一个周期
    setHidden(false);
    document.dispatchEvent(new Event('visibilitychange'));
    await advance(1);
    expect(fn).toHaveBeenCalledTimes(2);
  });

  test('滞后台切回前台：补偿执行不会连补多次', async () => {
    const fn = vi.fn();
    registerWorldTask('t', fn, 60_000);
    startWorldTick();

    setHidden(true);
    await advance(600_000);

    setHidden(false);
    document.dispatchEvent(new Event('visibilitychange'));
    await advance(HEARTBEAT_MS * 3);
    // 补跑一次后 lastRunAt 归零重新计时，不应把错过的十次一次性吐出来
    expect(fn).toHaveBeenCalledTimes(1);
  });

  test('单个任务抛错不连坐其他任务，且计入 errors', async () => {
    const bad = vi.fn(() => { throw new Error('boom'); });
    const good = vi.fn();
    registerWorldTask('bad', bad, 10_000);
    registerWorldTask('good', good, 10_000);
    startWorldTick();

    // 静音预期内的错误输出
    const origWarn = console.warn;
    console.warn = vi.fn();
    await advance(30_000);
    const snapshot = getWorldTaskSnapshot();
    console.warn = origWarn;

    expect(bad).toHaveBeenCalledTimes(3);
    expect(good).toHaveBeenCalledTimes(3);
    expect(snapshot.find((t) => t.name === 'bad').errors).toBe(3);
    expect(snapshot.find((t) => t.name === 'good').errors).toBe(0);
  });

  test('async 任务未返回时不重入', async () => {
    let release = null;
    const fn = vi.fn(() => new Promise((resolve) => { release = resolve; }));
    registerWorldTask('slow', fn, 10_000);
    startWorldTick();

    await advance(10_000);
    expect(fn).toHaveBeenCalledTimes(1);

    // 任务还没完成，继续推进两个周期也不应叠加
    await advance(20_000);
    expect(fn).toHaveBeenCalledTimes(1);

    release();
    await advance(10_000);
    expect(fn).toHaveBeenCalledTimes(2);
  });

  test('stopWorldTick 后不再驱动任何任务，可再次启动', async () => {
    const fn = vi.fn();
    registerWorldTask('t', fn, 10_000);
    startWorldTick();

    await advance(10_000);
    expect(fn).toHaveBeenCalledTimes(1);

    stopWorldTick();
    await advance(60_000);
    expect(fn).toHaveBeenCalledTimes(1);

    startWorldTick();
    await advance(10_000);
    expect(fn).toHaveBeenCalledTimes(2);
  });

  test('startWorldTick 幂等：重复启动不会让执行次数翻倍', async () => {
    const fn = vi.fn();
    registerWorldTask('t', fn, 10_000);
    startWorldTick();
    startWorldTick();
    startWorldTick();

    await advance(10_000);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  test('同名重复注册被拒绝，保留原有任务', async () => {
    const first = vi.fn();
    const second = vi.fn();
    const origWarn = console.warn;
    console.warn = vi.fn();
    registerWorldTask('dup', first, 10_000);
    registerWorldTask('dup', second, 10_000);
    console.warn = origWarn;

    startWorldTick();
    await advance(10_000);
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).not.toHaveBeenCalled();
  });

  test('非法参数直接抛错', () => {
    expect(() => registerWorldTask('x', 'not a function', 1000)).toThrow(TypeError);
    expect(() => registerWorldTask('y', () => {}, 0)).toThrow(RangeError);
    expect(() => registerWorldTask('z', () => {}, -1)).toThrow(RangeError);
  });

  test('注销函数可移除任务', async () => {
    const fn = vi.fn();
    const unregister = registerWorldTask('t', fn, 10_000);
    startWorldTick();

    await advance(10_000);
    expect(fn).toHaveBeenCalledTimes(1);

    unregister();
    await advance(30_000);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(getWorldTaskSnapshot()).toHaveLength(0);
  });
});
