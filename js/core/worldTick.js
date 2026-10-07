// js/core/worldTick.js - 世界统一心跳
//
// 背景：character / social / group 三条周期性任务原本各自持有独立的
// setInterval（由 app.js 的 registerInterval 注册），带来三个问题：
//
// 1. **相位独立**：三条时间线各跑各的，无法整体暂停 / 恢复 / 观测，
//    调试时也无从知道「下一拍轮到谁」。
// 2. **后台跳过且不顺延**：各任务自己在回调里 `if (document.hidden) return`，
//    后台期间 tick 照常触发却被丢弃 —— 切回前台后必须等到下一个完整周期
//    才真正执行，character 最长滞后 60s、social 最长 600s，回到前台时看到
//    的世界状态是旧的，要过一阵才追上。
// 3. **与时间引擎的先后顺序无保证**：time.js 在 visibilitychange 里才补推进
//    游戏时间，而三条 tick 什么时候跑取决于各自相位，二者谁先谁后没有约束。
//
// 这里收敛为单一心跳：一个 1s 的 setInterval 驱动所有已注册任务，任务按
// 「距上次执行已过去多久」判定是否到期。隐藏页期间**只走时间、不执行**，
// 于是回到前台时逾期任务被立刻判为到期并补跑，滞后随之消失。
//
// 各消费方（bodyState / social / groupEngine）本来就按 `lastUpdate` 时间差
// 做追补，补偿执行是幂等的，不会因为补跑而重复累积。
//
// 边界：
// - 任务回调抛错不会连坐其他任务，也不会中断心跳；错误计数到 snapshot 里，
//   便于观察长期失败的任务。
// - 同一任务在上一拍尚未结束时不重入（`running` 标志）：没有这层保护时，
//   慢任务会重叠执行。

/** 心跳基准间隔：所有到期判定都挂在它上面 */
export const HEARTBEAT_MS = 1000;

/**
 * 已注册任务表。
 * @type {Map<string, {
 *   name: string, fn: Function, intervalMs: number,
 *   lastRunAt: number, running: boolean, runs: number, errors: number
 * }>}
 */
const tasks = new Map();

let heartbeatId = null;
let detachVisibility = null;
let started = false;

function isHidden() {
  return typeof document !== 'undefined' && document.hidden === true;
}

/**
 * 驱动一轮到期判定。
 *
 * `lastRunAt` 在调用任务**之前**更新：即使本次执行抛错或迟迟不返回，
 * 也不会在下一拍被判为到期而重复排队（`running` 再挡一层）。
 */
function runDueTasks() {
  if (isHidden()) return;

  const now = Date.now();
  for (const task of tasks.values()) {
    if (task.running) continue;
    if (now - task.lastRunAt < task.intervalMs) continue;

    task.lastRunAt = now;
    task.runs += 1;
    task.running = true;
    Promise.resolve()
      .then(() => task.fn())
      .catch((err) => {
        task.errors += 1;
        console.warn(`[WorldTick] 任务 ${task.name} 执行异常:`, err);
      })
      .finally(() => {
        task.running = false;
      });
  }
}

/**
 * 切回前台：立刻补跑逾期任务。
 *
 * 让出一个宏任务再跑，是为了排在 time.js 的 visibilitychange 处理器之后——
 * 它在同一个事件里补推进游戏时间，早一步跑的任务会读到后台期间的陈旧时间。
 */
function handleVisibilityReturn() {
  if (isHidden()) return;
  setTimeout(runDueTasks, 0);
}

/**
 * 注册一个世界任务。
 *
 * @param {string} name - 任务名（同名重复注册会被拒绝，避免无声覆盖）
 * @param {Function} fn - 回调；返回 Promise 时由调度器接管等待
 * @param {number} intervalMs - 期望执行间隔（真实时间）
 * @returns {Function} 注销函数
 */
export function registerWorldTask(name, fn, intervalMs) {
  if (typeof fn !== 'function') {
    throw new TypeError(`[WorldTick] 任务 ${name} 的回调必须是函数`);
  }
  if (tasks.has(name)) {
    console.warn(`[WorldTick] 任务 ${name} 已存在，忽略重复注册`);
    return () => {};
  }
  const interval = Number(intervalMs);
  if (!Number.isFinite(interval) || interval <= 0) {
    throw new RangeError(`[WorldTick] 任务 ${name} 的间隔必须为正数`);
  }

  // 从注册时刻起算：保证「注册后满一个间隔才首次执行」，与各自独立
  // setInterval 的首次触发时机一致。
  tasks.set(name, {
    name,
    fn,
    intervalMs: interval,
    lastRunAt: Date.now(),
    running: false,
    runs: 0,
    errors: 0,
  });

  return () => {
    tasks.delete(name);
  };
}

/** 启动统一心跳（幂等） */
export function startWorldTick({ heartbeatMs = HEARTBEAT_MS } = {}) {
  if (started) return;
  started = true;

  heartbeatId = setInterval(runDueTasks, heartbeatMs);

  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', handleVisibilityReturn);
    detachVisibility = () => {
      document.removeEventListener('visibilitychange', handleVisibilityReturn);
    };
  }
}

/** 停止心跳与其事件挂载（幂等）。任务表保留，可再次 start */
export function stopWorldTick() {
  if (!started) return;
  started = false;

  if (heartbeatId !== null) {
    clearInterval(heartbeatId);
    heartbeatId = null;
  }
  if (detachVisibility) {
    detachVisibility();
    detachVisibility = null;
  }
}

/**
 * 清空任务表（仅供测试与「整体停机」场景）。
 * 心跳本身不停，空表时 runDueTasks 自然无操作。
 */
export function resetWorldTasks() {
  tasks.clear();
}

/**
 * 任务观测快照：external 巡检 / Engine Monitor / 测试都从这里读，
 * 不必各自去摸内部状态。
 * @returns {Array<{name: string, intervalMs: number, runs: number, errors: number, running: boolean, lastRunAt: number}>}
 */
export function getWorldTaskSnapshot() {
  return [...tasks.values()].map((t) => ({
    name: t.name,
    intervalMs: t.intervalMs,
    runs: t.runs,
    errors: t.errors,
    running: t.running,
    lastRunAt: t.lastRunAt,
  }));
}
