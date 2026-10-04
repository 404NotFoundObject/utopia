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

// 事件广播器：由 pluginRuntime 注入，用于把主线程 emit 的事件回传给 Worker。
// 修复审计 P1-4：Worker 的 api.events.on 订阅后，此前全链路无任何代码向 Worker post event:emit。
//
// 注意：必须用 var 而非 let/const。pluginApi 经
// pluginApi → modules/index → chat → chatUI → uiBridge → pluginRuntime → pluginApi
// 成环被嵌套求值，pluginRuntime 顶层会在 pluginApi 函数体执行前调用 setEventBroadcaster；
// 若为 let/const 则此处处于 TDZ（Cannot access 'eventBroadcaster' before initialization）。
// var 在模块实例化期即初始化为 undefined，循环依赖下赋值安全。请勿改回 let。
var eventBroadcaster = null;

/**
 * 注入事件广播器（由 pluginRuntime 调用，避免循环依赖）。
 * @param {(event: string, args: any[]) => void} broadcaster
 */
export function setEventBroadcaster(broadcaster) {
  eventBroadcaster = broadcaster;
}

/**
 * 主线程侧统一的事件发射：先触发本地 eventBus，再广播给订阅了该事件的 Worker。
 */
function emitToWorkers(event, args) {
  if (typeof eventBroadcaster === 'function') {
    try {
      eventBroadcaster(event, args);
    } catch (_) {}
  }
}

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

    emit: (event, ...args) => {
      const result = eventBus.emit(event, ...args);
      emitToWorkers(event, args);
      return result;
    },
    emitAsync: async (event, ...args) => {
      const result = await eventBus.emitAsync(event, ...args);
      emitToWorkers(event, args);
      return result;
    },
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
// 惰性执行：模块求值期（pluginApi 经 chat→chatUI→uiBridge→pluginRuntime 成环
// 被嵌套求值时），直接遍历 ModulesIndex 会命中"尚未求值完成的模块命名空间"，
// 在部分构建/测试环境下抛 Object.keys(undefined)。改为首次访问时再装载——
// 此时应用早已启动完成、所有模块就绪，API 形态与运行时行为完全不变。

let modulesLoaded = false;

function ensureModulesLoaded() {
  if (modulesLoaded) return;
  modulesLoaded = true;
  for (const [moduleName, moduleExports] of Object.entries(ModulesIndex)) {
    if (_api[moduleName] !== undefined) {
      console.warn(`[PluginApi] 模块名冲突: "${moduleName}" 已被占用，跳过`);
      continue;
    }
    // 防御：即便仍在求值中（理论上不会到达这里），未就绪的命名空间不包装
    if (!moduleExports || typeof moduleExports !== 'object') {
      console.warn(`[PluginApi] 模块 "${moduleName}" 尚未就绪，跳过装载`);
      continue;
    }
    _api[moduleName] = wrapModule(moduleName, moduleExports);
  }
}

// 兼容旧引用：原顶层循环在此直接执行，现暴露为可调用以确保装载完成
export { ensureModulesLoaded };

// ============================================================
// 方法路径解析
// ============================================================

export function resolveApiMethod(methodPath) {
  ensureModulesLoaded();
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
  ensureModulesLoaded();
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
  ensureModulesLoaded();
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