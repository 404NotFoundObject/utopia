// js/modules/time.js - 时间感知系统核心（集成事件总线）

import { getStores } from '../core/db.js';
import { getAppState } from '../core/state.js';
import globalEventBus from '../core/eventBus.js';

const TIME_STATE_ID = 'time_state';
const DEFAULT_SPEED = 1;
const MIN_SPEED = 1;
const MAX_SPEED = 48;
const DB_FLUSH_INTERVAL_MS = 10 * 1000;   // 每 10 秒写回 DB

let timeState = null;
let stores = null;
let isInitialized = false;

let cachedGameTime = 0;
let cachedRealTime = 0;
let cachedSpeed = 1;
let timerId = null;
let flushTimerId = null;
let visibilityListenerAttached = false;

// ============================================================
// 环境兼容工具
// ============================================================
function isDocumentHidden() {
  return typeof document !== 'undefined' && document.hidden === true;
}

// ============================================================
// 网络时间获取（失败返回 null，由调用方决定如何处理）
// ============================================================
async function fetchNetworkTime() {
  try {
    const response = await fetch('https://api.m.taobao.com/rest/api3.do?api=mtop.common.getTimestamp', {
      headers: { 'Cache-Control': 'no-cache, no-store, must-revalidate' },
    });
    const json = await response.json();
    if (json && json.data && json.data.t) return parseInt(json.data.t);
    throw new Error('淘宝 API 返回格式异常');
  } catch (error) {
    console.warn('[Time] 淘宝时间 API 失败:', error.message);
  }
  try {
    const response = await fetch('https://worldtimeapi.org/api/timezone/Asia/Shanghai', {
      headers: { 'Cache-Control': 'no-cache' },
    });
    const json = await response.json();
    if (json && json.unixtime) return json.unixtime * 1000;
    throw new Error('WorldTimeAPI 返回格式异常');
  } catch (error) {
    console.warn('[Time] WorldTimeAPI 失败:', error.message);
  }
  return null;
}

// ============================================================
// ★ 核心：从存储状态做离线推进（基于本地时间）
// ============================================================
function applyOfflineAdvance(state, reason = 'init') {
  const localNow = Date.now();
  const localLast = state.localRealTime || state.realTime || localNow;
  const offlineDelta = Math.max(0, localNow - localLast);

  if (offlineDelta > 1000 && !state.paused) {   // 至少 1 秒才算
    const gameAdvance = offlineDelta * state.speed;
    state.gameTime += gameAdvance;
    const minutes = (offlineDelta / 1000 / 60).toFixed(1);
    const gameMinutes = (gameAdvance / 1000 / 60).toFixed(1);
    console.log(`[Time] 离线推进 (${reason})：现实 ${minutes} 分钟 × ${state.speed}x = 游戏 ${gameMinutes} 分钟`);
  }

  state.localRealTime = localNow;
  state.realTime = localNow;
  state.lastUpdate = localNow;
  return state;
}


function handleVisibilityChange() {
  if (!isInitialized) return;
  if (isDocumentHidden()) return;   // 只处理"切回前台"

  if (!timeState) return;
  const now = Date.now();
  if (!timeState.paused) {
    const delta = (now - cachedRealTime) * cachedSpeed;
    if (delta > 0) {
      cachedGameTime = cachedGameTime + delta;
      cachedRealTime = now;
      // 通知 UI 时间已更新
      globalEventBus.emit('time:updated', {
        gameTime: cachedGameTime,
        realTime: now,
        speed: cachedSpeed,
        paused: false,
        timestamp: now,
      });
    }
  } else {
    cachedRealTime = now;
  }
}

function attachVisibilityListener() {
  if (visibilityListenerAttached) return;
  if (typeof document === 'undefined') return;
  document.addEventListener('visibilitychange', handleVisibilityChange);
  visibilityListenerAttached = true;
}

// ---------- 初始化 ----------
export async function initTime() {
  const settings = getAppState().get('settings');
  const timeDisabled = settings?.engineFlags?.time === false;

  // 已初始化：处理"运行时被动态禁用"的场景，停止定时器
  if (isInitialized) {
    if (timeDisabled && (timerId || flushTimerId)) {
      console.log('[Time] 时间系统已禁用，停止定时器');
      if (timerId) { clearInterval(timerId); timerId = null; }
      if (flushTimerId) { clearInterval(flushTimerId); flushTimerId = null; }
    }
    return timeState;
  }

  if (timeDisabled) {
    console.log('[Time] 时间系统已禁用（跳过定时器、离线推进、网络同步）');
  }

  stores = await getStores();
  let state = await stores.time_state.get(TIME_STATE_ID);
  const now = Date.now();

  if (!state) {
    // 首次创建
    state = {
      id: TIME_STATE_ID,
      gameTime: now,
      realTime: now,
      localRealTime: now,
      networkRealTime: null,
      speed: DEFAULT_SPEED,
      paused: false,
      lastUpdate: now,
    };
    await stores.time_state.add(state);
    console.log('[Time] 首次初始化时间状态');
  } else if (timeDisabled) {
    // 禁用状态下：仅同步本地时间戳，不推进游戏时间
    state.localRealTime = now;
    state.realTime = now;
    state.lastUpdate = now;
    await stores.time_state.update(TIME_STATE_ID, state);
  } else {
    // 启用状态下：执行离线推进
    const before = state.gameTime;
    applyOfflineAdvance(state, 'init');
    const advanced = state.gameTime - before;
    if (advanced > 1000) {
      console.log(`[Time] 离线推进完成，游戏时间前进 ${(advanced / 1000 / 60).toFixed(1)} 分钟`);
    }
    await stores.time_state.update(TIME_STATE_ID, state);
  }

  timeState = state;
  cachedGameTime = state.gameTime;
  cachedRealTime = state.localRealTime;
  cachedSpeed = state.speed;
  isInitialized = true;

  // 禁用状态：初始化已完成，不启动定时器与网络同步
  if (timeDisabled) return timeState;

  // 内存时钟：每秒推进（不写 DB）
  if (timerId) clearInterval(timerId);
  timerId = setInterval(() => {
    if (isDocumentHidden()) return;   // ★ 后台跳过算术
    if (!timeState.paused) {
      const now = Date.now();
      const delta = (now - cachedRealTime) * cachedSpeed;
      cachedGameTime = cachedGameTime + delta;
      cachedRealTime = now;
    } else {
      cachedRealTime = Date.now();
    }
  }, 1000);

  // 定时把内存状态写回 DB（每 10 秒）
  if (flushTimerId) clearInterval(flushTimerId);
  flushTimerId = setInterval(() => {
    if (isDocumentHidden()) return;   // ★ 后台跳过写回
    flushToDB().catch(err => console.warn('[Time] 定时写回失败:', err));
  }, DB_FLUSH_INTERVAL_MS);

  // 注册 visibilitychange 监听（幂等）
  attachVisibilityListener();

  // 尝试一次网络同步（成功则校准，失败不影响离线推进）
  syncTime().catch(err => console.warn('[Time] 首次网络同步失败:', err));

  return timeState;
}

// ============================================================
// flushToDB
// ============================================================
export async function flushToDB() {
  if (!stores || !timeState) return;
  timeState.gameTime = cachedGameTime;
  timeState.localRealTime = Date.now();
  timeState.realTime = timeState.localRealTime;
  await stores.time_state.update(TIME_STATE_ID, timeState);
}

// ============================================================
// 时间同步
// ============================================================
export async function syncTime() {
  if (!stores || !timeState) await initTime();

  const settings = getAppState().get('settings');
  if (settings?.engineFlags?.time === false) {
    const now = Date.now();
    timeState.localRealTime = now;
    timeState.realTime = now;
    timeState.lastUpdate = now;
    cachedRealTime = now;
    await stores.time_state.update(TIME_STATE_ID, timeState);
    return timeState;
  }

  const localNow = Date.now();
  const localLast = timeState.localRealTime || timeState.realTime || localNow;
  const localDelta = Math.max(0, localNow - localLast);

  const networkNow = await fetchNetworkTime();

  if (networkNow === null) {
    // ★ 网络时间失败时，用本地时间推进
    if (localDelta > 1000 && !timeState.paused) {
      timeState.gameTime += localDelta * timeState.speed;
      const minutes = (localDelta / 1000 / 60).toFixed(1);
      console.log(`[Time] 网络时间失败，仅用本地时间推进 ${minutes} 分钟 (x${timeState.speed})`);
    }
  } else {
    // 网络时间成功：用网络时间差校准（更精确）
    const networkLast = timeState.networkRealTime || networkNow;
    const networkDelta = networkNow - networkLast;
    let effectiveDelta = localDelta;

    if (networkDelta > 0 && Math.abs(networkDelta - localDelta) < 60 * 1000) {
      // 网络差和本地差接近（1 分钟内），用网络差更准
      effectiveDelta = networkDelta;
    }

    if (effectiveDelta > 1000 && !timeState.paused) {
      timeState.gameTime += effectiveDelta * timeState.speed;
      const minutes = (effectiveDelta / 1000 / 60).toFixed(1);
      console.log(`[Time] 网络同步推进 ${minutes} 分钟 (x${timeState.speed})`);
    }

    timeState.networkRealTime = networkNow;
  }

  timeState.localRealTime = localNow;
  timeState.realTime = localNow;
  timeState.lastUpdate = localNow;
  await stores.time_state.update(TIME_STATE_ID, timeState);

  cachedGameTime = timeState.gameTime;
  cachedRealTime = localNow;
  cachedSpeed = timeState.speed;

  globalEventBus.emit('time:updated', {
    gameTime: timeState.gameTime,
    realTime: timeState.realTime,
    speed: timeState.speed,
    paused: timeState.paused,
    timestamp: Date.now(),
  });

  return timeState;
}

// ---------- 获取当前游戏时间 ----------
export function getGameTime() {
  if (!timeState) return Date.now();
  if (timeState.paused) return timeState.gameTime;
  return cachedGameTime;
}

export function getGameDate() {
  return new Date(getGameTime());
}

export function getTimeSpeed() {
  return timeState?.speed ?? DEFAULT_SPEED;
}

export function isTimePaused() {
  return timeState?.paused ?? false;
}

export function getLastRealTime() {
  return timeState?.realTime ?? Date.now();
}

export function getStoredGameTime() {
  return timeState?.gameTime ?? Date.now();
}

// ---------- 时间控制 ----------
export async function setTimeSpeed(speed) {
  if (speed < MIN_SPEED || speed > MAX_SPEED) {
    throw new Error(`时间流速必须在 ${MIN_SPEED} 到 ${MAX_SPEED} 之间`);
  }
  await syncTime();
  timeState.speed = speed;
  cachedSpeed = speed;
  await stores.time_state.update(TIME_STATE_ID, timeState);
}

export async function setTimePaused(paused) {
  await syncTime();
  timeState.paused = paused;
  await stores.time_state.update(TIME_STATE_ID, timeState);
}

// ---------- 工具函数 ----------
export function getPeriod(hours) {
  if (hours >= 5 && hours < 8) return '清晨';
  if (hours >= 8 && hours < 12) return '上午';
  if (hours >= 12 && hours < 14) return '中午';
  if (hours >= 14 && hours < 18) return '下午';
  if (hours >= 18 && hours < 20) return '傍晚';
  if (hours >= 20 && hours < 23) return '夜晚';
  return '深夜';
}

export function getWeekday(date) {
  return ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'][date.getDay()];
}

export function formatGameTime(date) {
  const pad = n => String(n).padStart(2, '0');
  return `${date.getFullYear()}年${pad(date.getMonth() + 1)}月${pad(date.getDate())}日 ${getWeekday(date)} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function getTimeDescription() {
  const date = getGameDate();
  const hour = date.getHours();
  const period = getPeriod(hour);
  let detail = '';
  if (hour >= 23 || hour < 5) detail = '深夜，万籁俱寂，困意正浓。';
  else if (hour >= 5 && hour < 8) detail = '清晨，天色微亮，空气清新。';
  else if (hour >= 8 && hour < 12) detail = '上午，阳光正好，精力充沛。';
  else if (hour >= 12 && hour < 14) detail = '午间，有些倦意，适合小憩。';
  else if (hour >= 14 && hour < 18) detail = '下午，时间漫长，有点无聊。';
  else if (hour >= 18 && hour < 20) detail = '傍晚，夕阳西下，心情舒缓。';
  else if (hour >= 20 && hour < 23) detail = '夜晚，灯光柔和，放松时刻。';
  return `现在是${period}，${detail}`;
}

export function getTimeContext() {
  if (!timeState) {
    const now = Date.now();
    const date = new Date(now);
    const hours = date.getHours();
    const period = getPeriod(hours);
    const hourCN = hours > 12 ? hours - 12 : hours;
    const minuteCN = date.getMinutes();
    const timeCN = `${period}${hourCN}点${minuteCN > 0 ? minuteCN + '分' : ''}`;
    return {
      gameTime: {
        year: date.getFullYear(),
        month: date.getMonth() + 1,
        day: date.getDate(),
        weekday: getWeekday(date),
        hour: String(hours).padStart(2, '0'),
        minute: String(date.getMinutes()).padStart(2, '0'),
        period: period,
        full: formatGameTime(date),
        natural: `${date.getFullYear()}年${date.getMonth()+1}月${date.getDate()}日 ${getWeekday(date)} ${timeCN}`,
        description: getTimeDescription(),
      }
    };
  }
  const date = getGameDate();
  const hours = date.getHours();
  const period = getPeriod(hours);
  const hourCN = hours > 12 ? hours - 12 : hours;
  const minuteCN = date.getMinutes();
  const timeCN = `${period}${hourCN}点${minuteCN > 0 ? minuteCN + '分' : ''}`;
  return {
    gameTime: {
      year: date.getFullYear(),
      month: date.getMonth() + 1,
      day: date.getDate(),
      weekday: getWeekday(date),
      hour: String(hours).padStart(2, '0'),
      minute: String(date.getMinutes()).padStart(2, '0'),
      period: period,
      full: formatGameTime(date),
      natural: `${date.getFullYear()}年${date.getMonth()+1}月${date.getDate()}日 ${getWeekday(date)} ${timeCN}`,
      description: getTimeDescription(),
    }
  };
}

// ---------- 时间推进 ----------
export function advanceGameTime(milliseconds) {
    if (!timeState) {
        console.warn('[Time] 时间引擎未初始化，无法推进');
        return;
    }
    const delta = milliseconds;
    cachedGameTime += delta;
    cachedRealTime = Date.now();
    timeState.gameTime += delta;
    timeState.realTime = Date.now();
    timeState.localRealTime = Date.now();
    stores.time_state.update(TIME_STATE_ID, timeState).catch(err => {
        console.warn('[Time] 推进时间持久化失败:', err);
    });
    globalEventBus.emit('time:advanced', {
      gameTime: timeState.gameTime,
      realTime: timeState.realTime,
      delta,
      timestamp: Date.now(),
    });
    console.log(`[Time] 游戏时间已推进 ${milliseconds/1000/60/60} 小时，当前游戏时间:`, new Date(cachedGameTime).toLocaleString());
}

// ---------- 重置时间 ----------
export async function resetGameTime() {
    if (!stores || !timeState) {
        await initTime();
    }
    const now = Date.now();
    timeState.gameTime = now;
    timeState.realTime = now;
    timeState.localRealTime = now;
    await stores.time_state.update(TIME_STATE_ID, timeState);
    cachedGameTime = now;
    cachedRealTime = now;
    cachedSpeed = timeState.speed;
    const { getStores } = await import('./db.js');
    const storesAll = await getStores();
    const allChars = await storesAll.characters.getAll();
    for (const char of allChars) {
        char.lastInteraction = { gameTime: now, realTime: Date.now() };
        await storesAll.characters.update(char.id, char);
    }
    console.log('[Time] 游戏时间已重置为当前现实时间，所有角色的冷落状态已清除。');
    globalEventBus.emit('time:reset', {
      gameTime: now,
      realTime: now,
      timestamp: Date.now(),
    });
}