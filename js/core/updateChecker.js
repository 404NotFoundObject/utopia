// js/core/updateChecker.js - 版本检测与应用更新
//
// 背景（P3-10 阶段 B）：原先的更新检测是「鸡生蛋」——
//   checkAppVersion() 拿 APP_VERSION（**已加载的代码**里的常量）去比对 localStorage，
//   而 Service Worker 对静态资源是 stale-while-revalidate：首次打开先返回旧缓存。
//   于是用户长期不关页面时，跑的一直是旧代码、APP_VERSION 也是旧的，
//   与 localStorage 里存的旧值相同 → 永远不提示，也永远加载不到新版本。
//
// 修法：新增一个**不进缓存**的版本通道 version.json（由 sw.js 保证网络直通），
// 版本号不再依赖「正在运行的代码」。同时把阻塞式 confirm() 换成非阻塞横幅，
// 补上定期 + 恢复可见两种触发时机。
//
// 离线时静默降级：fetch 失败当作「无法判断」，不打扰用户。

import {
  APP_VERSION,
  STORAGE_VERSION_KEY,
  DISMISSED_UPDATE_KEY,
  LAST_CHECK_KEY,
} from './appMeta.js';

/** 版本探测通道。相对路径：本地 server、子路径部署都要能取到。 */
export const VERSION_URL = './version.json';

/** 定时检查间隔（30 分钟） */
export const WATCH_INTERVAL_MS = 30 * 60 * 1000;

/** 同一版本横幅的去重窗口：用户点过「稍后」后不再反复弹（有新版本会重新弹） */
const MIN_RECHECK_GAP_MS = 10 * 60 * 1000;

/** 更新后等待新 SW 接管的最长时间 */
const CONTROLLER_WAIT_MS = 2000;

let _state = {
  status: 'idle', // idle | up-to-date | update-available | unavailable
  remote: null, // { version, build, channel }
  lastCheckedAt: null,
  lastRunAt: 0,
};

function emit(event, payload) {
  try {
    if (typeof window !== 'undefined' && window.__eventBus?.emit) {
      window.__eventBus.emit(event, payload);
    }
  } catch (_) { /* 事件总线不可用时忽略：更新检测不能因为总线异常而中断 */ }
}

function readStorage(key) {
  try { return localStorage.getItem(key); } catch (_) { return null; }
}

function writeStorage(key, value) {
  try { localStorage.setItem(key, value); } catch (_) { return false; }
  return true;
}

// ============================================================
// 版本比较
// ============================================================

/**
 * 解析版本号的数值段。非数字段按 0 处理（如 3.9.4-beta → [3,9,4]）。
 * @param {string} v
 * @returns {number[]}
 */
export function parseVersion(v) {
  return String(v ?? '')
    .trim()
    .replace(/^v/i, '')
    .split('.')
    .map((seg) => {
      const n = parseInt(seg, 10);
      return Number.isFinite(n) ? n : 0;
    });
}

/**
 * 比较两个版本号。
 * @returns {number} 1：a 更新；-1：b 更新；0：相同
 */
export function compareVersions(a, b) {
  const pa = parseVersion(a);
  const pb = parseVersion(b);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i += 1) {
    const va = pa[i] ?? 0;
    const vb = pb[i] ?? 0;
    if (va > vb) return 1;
    if (va < vb) return -1;
  }
  return 0;
}

/**
 * remote 是否比 local 新（3.10.0 > 3.9.9 这类跨位比较也不能判错）。
 * 解析不出有效数字时一律视为「不更新」，避免把脏数据当成新版本。
 */
export function isNewerVersion(remote, local) {
  if (!remote || !local) return false;
  const pa = parseVersion(remote);
  if (pa.length === 0 || pa.every((n) => n === 0)) return false;
  return compareVersions(remote, local) > 0;
}

export function getLocalVersion() {
  return APP_VERSION;
}

// ============================================================
// 探测
// ============================================================

/**
 * 拉取远端版本信息。失败（离线 / 文件缺失 / 格式不对）统一返回 null，
 * 由调用方降级为「无法判断」。
 * @returns {Promise<{version: string, build: string|null, channel: string}|null>}
 */
export async function fetchRemoteVersion() {
  if (typeof fetch !== 'function') return null;
  try {
    const res = await fetch(VERSION_URL, {
      cache: 'no-store',
      headers: { 'Cache-Control': 'no-cache' },
      credentials: 'same-origin',
    });
    if (!res || !res.ok) return null;
    const data = await res.json();
    if (!data || typeof data.version !== 'string' || !data.version.trim()) return null;
    return {
      version: data.version.trim(),
      build: typeof data.build === 'string' ? data.build : null,
      channel: typeof data.channel === 'string' ? data.channel : 'stable',
    };
  } catch (_) {
    return null; // 离线：静默
  }
}

let _pendingCheck = null;

/**
 * 检查是否有新版本。并发调用共享同一个请求（设置页手点 + 定时检查同时发生时只发一次）。
 * @returns {Promise<{status: string, hasUpdate: boolean, local: string, remote: string|null, build?: string|null}>}
 */
export async function checkForUpdate() {
  if (_pendingCheck) return _pendingCheck;

  _pendingCheck = (async () => {
    const local = getLocalVersion();
    const remoteInfo = await fetchRemoteVersion();

    _state.lastCheckedAt = new Date().toISOString();
    _state.lastRunAt = Date.now();
    writeStorage(LAST_CHECK_KEY, _state.lastCheckedAt);

    if (!remoteInfo) {
      _state.status = 'unavailable';
      _state.remote = null;
      return { status: 'unavailable', hasUpdate: false, local, remote: null };
    }

    _state.remote = remoteInfo;
    const hasUpdate = isNewerVersion(remoteInfo.version, local);
    _state.status = hasUpdate ? 'update-available' : 'up-to-date';

    const result = {
      status: _state.status,
      hasUpdate,
      local,
      remote: remoteInfo.version,
      build: remoteInfo.build,
      channel: remoteInfo.channel,
    };
    if (hasUpdate) emit('app:update-available', result);
    return result;
  })();

  try {
    return await _pendingCheck;
  } finally {
    _pendingCheck = null;
  }
}

/**
 * 供设置页展示的当前状态快照。
 */
export function getUpdateState() {
  return {
    status: _state.status,
    remote: _state.remote ? { ..._state.remote } : null,
    local: getLocalVersion(),
    lastCheckedAt: _state.lastCheckedAt ?? readStorage(LAST_CHECK_KEY),
    dismissedVersion: getDismissedVersion(),
  };
}

/** 仅供测试：清空模块内状态 */
export function _resetState() {
  _state = { status: 'idle', remote: null, lastCheckedAt: null, lastRunAt: 0 };
}

// ============================================================
// 落地更新
// ============================================================

/**
 * 清空所有 Cache Storage。SW 对静态资源是「先回缓存、后台刷新」，
 * 不清缓存直接 reload，拿到的仍是旧 JS —— 这是必须先做的一步。
 * @returns {Promise<number>} 清掉的缓存桶数量
 */
export async function clearAppCaches() {
  if (typeof caches === 'undefined' || typeof caches?.keys !== 'function') return 0;
  try {
    const keys = await caches.keys();
    await Promise.all(keys.map((k) => caches.delete(k)));
    return keys.length;
  } catch (_) {
    return 0;
  }
}

async function getRegistration() {
  try {
    if (typeof navigator === 'undefined' || !navigator.serviceWorker) return null;
    if (typeof navigator.serviceWorker.getRegistration !== 'function') return null;
    return (await navigator.serviceWorker.getRegistration()) || null;
  } catch (_) {
    return null;
  }
}

/** 等待新 SW 接管（controllerchange），最多等 ms 毫秒 */
function waitForControllerChange(ms) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { navigator.serviceWorker.removeEventListener('controllerchange', onChange); } catch (_) {}
      resolve(value);
    };
    const onChange = () => finish(true);
    const timer = setTimeout(() => finish(false), ms);
    try {
      navigator.serviceWorker.addEventListener('controllerchange', onChange);
    } catch (_) {
      finish(false);
    }
  });
}

/**
 * 应用更新：清缓存 → 触发 SW 更新 → 等新 SW 接管（有上限）→ 重载。
 *
 * @param {{reload?: Function, waitMs?: number}} [options]
 *   reload 可注入，便于测试；默认 `() => window.location.reload()`。
 * @returns {Promise<{cleared: number, reloaded: boolean}>}
 */
export async function applyUpdate(options = {}) {
  const waitMs = Number.isFinite(options.waitMs) ? options.waitMs : CONTROLLER_WAIT_MS;

  const cleared = await clearAppCaches();

  const reg = await getRegistration();
  if (reg && typeof reg.update === 'function') {
    try { await reg.update(); } catch (_) { /* 更新失败也要走到重载 */ }
  }
  if (reg) await waitForControllerChange(waitMs);

  // 记录下来：重载后即便远端 version.json 已被 CDN 缓存，本地记录也是可信的
  writeStorage(STORAGE_VERSION_KEY, _state.remote?.version || getLocalVersion());

  const reload = typeof options.reload === 'function'
    ? options.reload
    : () => { if (typeof window !== 'undefined') window.location.reload(); };
  reload();

  return { cleared, reloaded: true };
}

// ============================================================
// 横幅（非阻塞）
// ============================================================

export const UPDATE_BANNER_ID = 'appUpdateBanner';

export function getDismissedVersion() {
  return readStorage(DISMISSED_UPDATE_KEY);
}

export function dismissUpdate(version) {
  writeStorage(DISMISSED_UPDATE_KEY, String(version ?? ''));
}

export function hideUpdateBanner() {
  if (typeof document === 'undefined') return;
  const el = document.getElementById(UPDATE_BANNER_ID);
  if (el) el.remove();
}

/**
 * 展示非阻塞更新横幅（右上角浮层，不打断输入）。
 *
 * @param {Object} [options]
 * @param {string} [options.version] - 新版本号，缺省取最近一次检查结果
 * @param {Function} [options.onApply] - 点「立即更新」的回调，默认走 applyUpdate()
 * @param {Function} [options.onDismiss] - 点「稍后」的回调，默认记住该版本并关闭
 * @returns {HTMLElement|null}
 */
export function showUpdateBanner(options = {}) {
  if (typeof document === 'undefined' || !document.body) return null;

  const version = options.version || _state.remote?.version || getLocalVersion();
  hideUpdateBanner(); // 同一时刻只留一条

  const banner = document.createElement('div');
  banner.id = UPDATE_BANNER_ID;
  banner.className = 'app-update-banner';
  banner.setAttribute('role', 'status');

  const text = document.createElement('span');
  text.className = 'app-update-text';
  text.textContent = `发现新版本 v${version}`;
  banner.appendChild(text);

  const applyBtn = document.createElement('button');
  applyBtn.type = 'button';
  applyBtn.className = 'app-update-apply';
  applyBtn.textContent = '立即更新';
  applyBtn.addEventListener('click', () => {
    const handler = options.onApply || (() => applyUpdate());
    applyBtn.disabled = true;
    applyBtn.textContent = '更新中…';
    Promise.resolve(handler(version)).catch((err) => {
      console.warn('[UpdateChecker] 应用更新失败:', err);
      applyBtn.disabled = false;
      applyBtn.textContent = '重试';
    });
  });
  banner.appendChild(applyBtn);

  const laterBtn = document.createElement('button');
  laterBtn.type = 'button';
  laterBtn.className = 'app-update-later';
  laterBtn.textContent = '稍后';
  laterBtn.addEventListener('click', () => {
    if (options.onDismiss) options.onDismiss(version);
    else {
      dismissUpdate(version);
      hideUpdateBanner();
    }
  });
  banner.appendChild(laterBtn);

  document.body.appendChild(banner);
  return banner;
}

// ============================================================
// 守护：定期 + 恢复可见
// ============================================================

/**
 * 启动更新守护：启动延迟检查一次、定时轮询、页面恢复可见且距上次检查够久时补一次。
 * 发现新版本默认弹非阻塞横幅（同一版本被「稍后」过则不再打扰）。
 *
 * @param {Object} [options]
 * @param {number} [options.intervalMs]
 * @param {boolean} [options.autoBanner] - 是否自动弹横幅
 * @param {boolean} [options.runOnStart] - 启动是否检查（延迟 3s，不抢首屏）
 * @returns {Function} stop - 取消守护
 */
export function startUpdateWatch(options = {}) {
  const intervalMs = Number.isFinite(options.intervalMs) ? options.intervalMs : WATCH_INTERVAL_MS;
  const autoBanner = options.autoBanner !== false;
  const runOnStart = options.runOnStart !== false;

  const stopFns = [];

  // 兼容旧实现 semantics：首次启动时登记当前版本，便于排障与后续比对
  if (!readStorage(STORAGE_VERSION_KEY)) writeStorage(STORAGE_VERSION_KEY, getLocalVersion());

  async function scan() {
    const result = await checkForUpdate();
    if (!result.hasUpdate) return result;
    if (getDismissedVersion() === result.remote) return result;
    if (autoBanner) showUpdateBanner({ version: result.remote });
    return result;
  }

  if (runOnStart) {
    const timer = setTimeout(() => { scan().catch(() => {}); }, 3000);
    stopFns.push(() => clearTimeout(timer));
  }

  const timer = setInterval(() => { scan().catch(() => {}); }, intervalMs);
  stopFns.push(() => clearInterval(timer));

  const onVisibilityChange = () => {
    if (typeof document !== 'undefined' && document.hidden) return;
    const since = Date.now() - (_state.lastRunAt || 0);
    if (since < MIN_RECHECK_GAP_MS) return;
    scan().catch(() => {});
  };
  if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
    document.addEventListener('visibilitychange', onVisibilityChange);
    stopFns.push(() => document.removeEventListener('visibilitychange', onVisibilityChange));
  }

  return function stop() {
    stopFns.forEach((fn) => { try { fn(); } catch (_) {} });
  };
}
