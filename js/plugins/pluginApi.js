/**
 * @module plugins/pluginApi
 * @description 插件 API 聚合层
 *
 * 设计：
 *   - 从 js/modules/index.js 自动读取所有核心模块
 *   - 用 Proxy 包装每个方法，自动触发 before/after/error 钩子
 *   - events 和 hooks 需要特殊处理（涉及 pluginId 和订阅管理）
 */

// ============================================================
// 核心模块索引（自动遍历）
// ============================================================
import * as ModulesIndex from '../modules/index.js';

// ============================================================
// 核心基础模块（在 core/ 下，不走 modules/index.js）
// ============================================================
import * as apiModule from '../core/api.js';
import * as dbModule from '../core/db.js';
import * as utilsModule from '../core/utils.js';
import eventBus from '../core/eventBus.js';
import { getAppState } from '../core/state.js';

// ============================================================
// 服务层（在 services/ 下）
// ============================================================
import * as ttsModule from '../services/ttsService.js';
import * as sttModule from '../services/sttService.js';

// ============================================================
// 钩子系统
// ============================================================
import * as hookSystem from './hookSystem.js';

// ============================================================
// 版本
// ============================================================
export const API_VERSION = '1.0.0';
export const UTOPIA_VERSION = '3.2.0';

// ============================================================
// 事件订阅管理器（按插件隔离）
// ============================================================

// pluginId -> Set<eventName>
const subscribedEvents = new Map();

// pluginId -> unsubscribe 函数列表
const eventUnsubscribers = new Map();

// ============================================================
// 模块包装器：Proxy 自动钩子
// ============================================================

function wrapModule(moduleName, originalModule) {
  const wrapped = {};

  for (const key of Object.keys(originalModule)) {
    const value = originalModule[key];

    if (typeof value !== 'function') {
      wrapped[key] = value;
      continue;
    }

    const hookBase = `${moduleName}.${key}`;

    wrapped[key] = async function (...args) {
      // ---------- before ----------
      let finalArgs = args;
      try {
        const beforeCtx = await hookSystem.triggerHook(`${hookBase}:before`, {
          args,
          module: moduleName,
          method: key,
          cancelled: false,
        });
        if (beforeCtx._stopped || beforeCtx.cancelled) {
          const err = new Error(`${hookBase} 被插件取消`);
          err._cancelled = true;
          throw err;
        }
        if (Array.isArray(beforeCtx.args)) {
          finalArgs = beforeCtx.args;
        }
      } catch (err) {
        if (err._cancelled) throw err;
        console.error(`[ApiProxy] ${hookBase}:before 失败:`, err);
      }

      // ---------- 调用原函数 ----------
      let result;
      try {
        result = await value.apply(originalModule, finalArgs);
      } catch (err) {
        try {
          await hookSystem.triggerHook(`${hookBase}:error`, {
            args: finalArgs,
            error: err,
          });
        } catch (_) {}
        throw err;
      }

      // ---------- after ----------
      try {
        const afterCtx = await hookSystem.triggerHook(`${hookBase}:after`, {
          args: finalArgs,
          result,
        });
        if (afterCtx.result !== undefined) {
          result = afterCtx.result;
        }
      } catch (err) {
        console.error(`[ApiProxy] ${hookBase}:after 失败:`, err);
      }

      return result;
    };

    wrapped[key]._wrapped = true;
    wrapped[key]._moduleName = moduleName;
    wrapped[key]._methodName = key;
  }

  return wrapped;
}

// ============================================================
// 事件订阅的插件级隔离
// ============================================================

function pluginEventSubscribe(pluginId, event, callback) {
  if (pluginId) {
    if (!subscribedEvents.has(pluginId)) {
      subscribedEvents.set(pluginId, new Set());
    }
    subscribedEvents.get(pluginId).add(event);

    const unsub = eventBus.on(event, callback);
    if (!eventUnsubscribers.has(pluginId)) {
      eventUnsubscribers.set(pluginId, []);
    }
    eventUnsubscribers.get(pluginId).push(unsub);
    return unsub;
  }
  return eventBus.on(event, callback);
}

export function cleanupPluginEventSubscriptions(pluginId) {
  const unsubs = eventUnsubscribers.get(pluginId);
  if (unsubs) {
    for (const unsub of unsubs) {
      try { unsub(); } catch (_) {}
    }
    eventUnsubscribers.delete(pluginId);
  }
  subscribedEvents.delete(pluginId);
}

export function getPluginSubscribedEvents(pluginId) {
  const set = subscribedEvents.get(pluginId);
  return set ? Array.from(set) : [];
}

// ============================================================
// 构建 API 对象
// ============================================================

const _api = {
  // ---- 元信息 ----
  apiVersion: API_VERSION,
  utopiaVersion: UTOPIA_VERSION,

  // ---- 状态管理 ----
  state: {
    get: (path) => getAppState().get(path),
    set: (path, value) => getAppState().set(path, value),
    subscribe: (path, cb) => getAppState().subscribe(path, cb),
    subscribeAll: (cb) => getAppState().subscribeAll(cb),
  },

  // ============================================================
  // ★ 事件（补齐 on / once / off）
  // ============================================================
  events: {
    // ---- 主接口 ----
    on: (event, callback, opts) => eventBus.on(event, callback, opts),
    once: (event, callback, opts) => eventBus.once(event, callback, opts),
    off: (event, callback) => eventBus.off(event, callback),

    // ---- 兼容旧接口 ----
    subscribe: (event, callback) => eventBus.on(event, callback),
    unsubscribe: (event, callback) => eventBus.off(event, callback),

    emit: (event, ...args) => eventBus.emit(event, ...args),
    emitAsync: (event, ...args) => eventBus.emitAsync(event, ...args),
    getEventNames: () => eventBus.getEventNames(),
  },

  // ============================================================
  // ★ 钩子（供 Worker RPC 调用，pluginId 由 invokeApiMethod 注入）
  // ============================================================
  hooks: {
    register: (pluginId, hookName, opts) => hookSystem.registerHook(pluginId, hookName, opts),
    unregister: (pluginId, hookName) => hookSystem.unregisterHook(pluginId, hookName),
    unregisterAll: (pluginId) => hookSystem.unregisterAllHooks(pluginId),
    list: () => hookSystem.listHooks(),
  },

  // ---- 核心基础（core/） ----
  api: wrapModule('api', apiModule),
  db: wrapModule('db', dbModule),
  utils: wrapModule('utils', utilsModule),

  // ---- 服务层（services/） ----
  tts: wrapModule('tts', ttsModule),
  stt: wrapModule('stt', sttModule),
};

// ============================================================
// 自动装载：从 modules/index.js 遍历所有核心模块
// ============================================================

for (const [moduleName, moduleExports] of Object.entries(ModulesIndex)) {
  if (_api[moduleName] !== undefined) {
    console.warn(`[PluginApi] 模块名冲突: "${moduleName}" 已被占用，跳过`);
    continue;
  }
  _api[moduleName] = wrapModule(moduleName, moduleExports);
}

// ============================================================
// 方法路径解析
// ============================================================

export function resolveApiMethod(methodPath) {
  if (typeof methodPath !== 'string') return null;
  const parts = methodPath.split('.');
  if (parts.length !== 2) return null;

  const [moduleName, methodName] = parts;
  const module = _api[moduleName];
  if (!module || typeof module !== 'object') return null;

  const fn = module[methodName];
  if (typeof fn !== 'function') return null;

  return { fn, moduleName, methodName, context: module };
}

// ============================================================
// 方法调用入口（供 RPC 路由使用）
// ============================================================

export async function invokeApiMethod(methodPath, args = [], callerContext = {}) {
  const pluginId = callerContext.pluginId;

  // ============================================================
  // 特殊处理：hooks（需要注入 pluginId）
  // ============================================================
  if (methodPath === 'hooks.register') {
    const hookName = args[0];
    const opts = args[1] || {};
    hookSystem.registerHook(pluginId, hookName, opts);
    return { ok: true };
  }
  if (methodPath === 'hooks.unregister') {
    const hookName = args[0];
    return { ok: hookSystem.unregisterHook(pluginId, hookName) };
  }
  if (methodPath === 'hooks.unregisterAll') {
    hookSystem.unregisterAllHooks(pluginId);
    return { ok: true };
  }
  if (methodPath === 'hooks.list') {
    return hookSystem.listHooks();
  }

  // ============================================================
  // 特殊处理：events（按 pluginId 记录订阅）
  // ============================================================
  if (methodPath === 'events.subscribe') {
    const event = args[0];
    if (!subscribedEvents.has(pluginId)) {
      subscribedEvents.set(pluginId, new Set());
    }
    subscribedEvents.get(pluginId).add(event);
    return { ok: true, event };
  }
  if (methodPath === 'events.unsubscribe') {
    const event = args[0];
    const set = subscribedEvents.get(pluginId);
    if (set) set.delete(event);
    return { ok: true, event };
  }

  // ============================================================
  // 通用方法
  // ============================================================
  const resolved = resolveApiMethod(methodPath);
  if (!resolved) {
    throw new Error('未知的 API 方法: ' + methodPath);
  }

  const result = await resolved.fn.apply(resolved.context, args);
  return serializeResult(result);
}

/**
 * 序列化 API 返回结果
 */
function serializeResult(result) {
  if (result === undefined || result === null) return result;

  const t = typeof result;
  if (t === 'function' || t === 'symbol') return null;
  if (t === 'bigint') return Number(result);
  if (t === 'string' || t === 'number' || t === 'boolean') return result;

  if (result instanceof Date) {
    return { __type: 'Date', value: result.getTime() };
  }

  if (Array.isArray(result)) {
    return result.map(serializeResult);
  }

  return result;
}

// ============================================================
// 调试工具
// ============================================================

export function listApiMethods() {
  const result = {};
  for (const [moduleName, module] of Object.entries(_api)) {
    if (typeof module !== 'object') continue;
    result[moduleName] = Object.keys(module).filter(
      k => typeof module[k] === 'function'
    );
  }
  return result;
}

// ============================================================
// 导出
// ============================================================

export default _api;
export { _api as UtopiaApi };