// js/core/state.js - 简单发布-订阅状态管理
// 注意：本文件不依赖任何其他模块，不要在这里 import 自己

export function createState(initialState = {}) {
  const state = { ...initialState };
  const listeners = new Map(); // key: path, value: Set of callbacks

  const get = (path) => {
    if (path === undefined) return state;
    const parts = path.split('.');
    let val = state;
    for (const p of parts) {
      if (val === undefined || val === null) return undefined;
      val = val[p];
    }
    return val;
  };

  /**
   * 设置状态
   * @param {string} path - 点号路径
   * @param {*} value - 新值
   * @param {Object} [opts]
   * @param {boolean} [opts.force=false] - 强制通知订阅者（即使引用相同）
   * @param {boolean} [opts.createMissing=false] - 是否允许自动创建中间路径
   */
  const set = (path, value, opts = {}) => {
    const oldValue = get(path);
    const force = opts.force === true;
    const createMissing = opts.createMissing === true;
    if (!force && oldValue === value) return;

    const parts = path.split('.');
    let obj = state;

    for (let i = 0; i < parts.length - 1; i++) {
      const key = parts[i];
      const next = obj[key];
      const partialPath = parts.slice(0, i + 1).join('.');

      if (next === undefined || next === null) {
        if (!createMissing) {
          throw new Error(
            `[State] set("${path}") 失败：中间路径 "${partialPath}" 不存在。` +
            `如确需动态创建，请传入 { createMissing: true }。`
          );
        }
        obj[key] = {};
      } else if (typeof next !== 'object') {
        if (!createMissing) {
          throw new Error(
            `[State] set("${path}") 失败：中间路径 "${partialPath}" 已存在但不是对象（是 ${typeof next}）。`
          );
        }
        obj[key] = {};
      }
      obj = obj[key];
    }

    obj[parts[parts.length - 1]] = value;

    // 通知监听器（精确路径）
    const cbs = listeners.get(path);
    if (cbs) {
      for (const cb of cbs) {
        try {
          cb(value, oldValue);
        } catch (e) {
          console.error(`[State] 订阅回调异常 (path=${path}):`, e);
        }
      }
    }

    // 通知通配符 '*'
    const allCbs = listeners.get('*');
    if (allCbs) {
      for (const cb of allCbs) {
        try {
          cb(path, value, oldValue);
        } catch (e) {
          console.error(`[State] 通配符订阅回调异常 (path=${path}):`, e);
        }
      }
    }
  };

  const subscribe = (path, callback) => {
    if (!listeners.has(path)) listeners.set(path, new Set());
    listeners.get(path).add(callback);
    return () => {
      listeners.get(path)?.delete(callback);
    };
  };

  const subscribeAll = (callback) => subscribe('*', callback);

  return { get, set, subscribe, subscribeAll };
}

// 全局状态实例（懒加载）
let appState = null;
export function getAppState() {
  if (!appState) {
    appState = createState({
      // ---- 核心状态 ----
      currentCharacterId: null,
      currentConversationId: null,
      currentMode: 'chat',           // 'chat' | 'group'
      currentGroupId: null,

      // ---- 数据列表 ----
      characters: [],
      conversations: [],
      groups: [],

      // ---- 设置 ----
      settings: null,

      // ---- UI 状态 ----
      sidebarOpen: false,
      isLoading: false,
      isMobile: window.innerWidth < 768,
      sending: false,

      // ---- 命令系统 ----
      pendingInjection: null,        // 一次性注入内容（/inject 命令使用）

      // ---- 其他 ----
      callCount: 0,
    });
  }
  return appState;
}