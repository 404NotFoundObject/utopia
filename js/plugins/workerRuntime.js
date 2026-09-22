/**
 * @module plugins/workerRuntime
 * @description Worker 侧运行时胶水代码
 *
 * 通过 Function.toString() 注入到每个插件 Worker 中，提供：
 *   - self.api：对插件透明的 API 代理（所有调用转为 RPC）
 *   - RPC 请求/响应机制
 *   - 钩子处理转发
 *   - 事件订阅
 *   - 生命周期管理
 *
 * 注意：
 *   - _workerRuntimeMain 必须完全自包含，不能引用外部作用域
 *   - state 模块做了特殊处理：subscribe/subscribeAll 在 Worker 侧不可用
 *     （因为回调函数无法跨 Worker 传递）
 *
 */

import * as ModulesIndex from '../modules/index.js';

// ============================================================
// Worker 侧运行时主体
// ============================================================

function _workerRuntimeMain() {
  'use strict';

  // ---- 状态 ----
  const rpcPending = new Map();
  let rpcCounter = 0;
  const hookHandlers = new Map();        // hookName -> handler
  const eventHandlers = new Map();       // eventName -> Set<handler>
  let manifest = null;
  let pluginInstance = null;
  let teardownFn = null;

  // ---- 日志辅助 ----
  function log(level, message) {
    self.postMessage({
      type: 'log',
      payload: { level, message: String(message) },
    });
  }

  // ============================================================
  // RPC 请求
  // ============================================================
  function rpcCall(method, args, timeoutMs = 30000) {
    return new Promise((resolve, reject) => {
      const id = 'rpc_' + (++rpcCounter) + '_' + Date.now();
      const timeout = setTimeout(() => {
        if (rpcPending.has(id)) {
          rpcPending.delete(id);
          reject(new Error('RPC 超时: ' + method));
        }
      }, timeoutMs);

      rpcPending.set(id, {
        resolve: (v) => { clearTimeout(timeout); resolve(v); },
        reject: (e) => { clearTimeout(timeout); reject(e); },
      });

      self.postMessage({
        id,
        type: 'rpc:request',
        payload: { method, args },
      });
    });
  }

  // ============================================================
  // API 代理
  // ============================================================
  const api = {};

  Object.defineProperty(api, 'apiVersion', {
    get: () => '1.0.0',
    enumerable: true,
  });
  Object.defineProperty(api, 'utopiaVersion', {
    get: () => '3.2.0',
    enumerable: true,
  });

  // 通用模块代理
  function createModuleProxy(moduleName) {
    return new Proxy({}, {
      get(_, methodName) {
        if (typeof methodName !== 'string') return undefined;
        return (...args) => rpcCall(moduleName + '.' + methodName, args);
      },
    });
  }

  const moduleNames = __UTOPIA_MODULE_NAMES__;

  // ---- 除 state 外的通用模块 ----
  // 注意：state 被排除，因为它的 subscribe 系列无法跨 Worker
  for (let i = 0; i < moduleNames.length; i++) {
    api[moduleNames[i]] = createModuleProxy(moduleNames[i]);
  }

  // ============================================================
  // ★ state 特殊处理
  // ============================================================
  // Worker 侧无法使用 subscribe/subscribeAll（回调无法跨 Worker 传递）
  // 提供 get/set 的 RPC 代理，subscribe 系列抛出明确错误
  api.state = {
    get: (path) => rpcCall('state.get', [path]),
    set: (path, value) => rpcCall('state.set', [path, value]),
    subscribe: () => {
      throw new Error(
        '[Plugin] Worker 侧不支持 state.subscribe（回调无法跨 Worker 传递）。' +
        '请改用 api.events.on() 订阅事件，或在 ui.js 中使用 uiApi.api.state.subscribe()。'
      );
    },
    subscribeAll: () => {
      throw new Error(
        '[Plugin] Worker 侧不支持 state.subscribeAll（回调无法跨 Worker 传递）。' +
        '请改用 api.events.on() 订阅事件，或在 ui.js 中使用 uiApi.api.state.subscribeAll()。'
      );
    },
  };

  // ============================================================
  // 事件 API
  // ============================================================
  // 注意：Worker 侧的 events.on 使用本地 handler 存储，
  // 主线程只需知道"订阅了哪些事件"，不需要知道 handler（handler 无法跨 Worker）。
  api.events = {
    on: (event, handler) => {
      if (typeof handler !== 'function') {
        throw new TypeError('事件处理函数必须是函数');
      }
      if (!eventHandlers.has(event)) eventHandlers.set(event, new Set());
      eventHandlers.get(event).add(handler);
      // 通知主线程（幂等）
      rpcCall('events.subscribe', [event]).catch(() => {});
      // 返回取消订阅函数
      return () => api.events.off(event, handler);
    },
    once: (event, handler) => {
      const wrapped = function () {
        try {
          handler.apply(null, arguments);
        } finally {
          api.events.off(event, wrapped);
        }
      };
      return api.events.on(event, wrapped);
    },
    off: (event, handler) => {
      const set = eventHandlers.get(event);
      if (!set) return;
      set.delete(handler);
      if (set.size === 0) {
        eventHandlers.delete(event);
        rpcCall('events.unsubscribe', [event]).catch(() => {});
      }
    },
    emit: (event, ...args) => rpcCall('events.emit', [event, ...args]),
    emitAsync: (event, ...args) => rpcCall('events.emitAsync', [event, ...args]),
    getEventNames: () => rpcCall('events.getEventNames', []),
  };

  // ============================================================
  // 钩子 API
  // ============================================================
  api.hooks = {
    register: (hookName, handler, opts = {}) => {
      if (typeof handler !== 'function') {
        throw new TypeError('钩子处理函数必须是函数');
      }
      if (hookHandlers.has(hookName)) {
        console.warn('[Worker] 钩子 ' + hookName + ' 已注册，将被覆盖');
      }
      hookHandlers.set(hookName, handler);
      return rpcCall('hooks.register', [hookName, opts]);
    },
    unregister: (hookName) => {
      hookHandlers.delete(hookName);
      return rpcCall('hooks.unregister', [hookName]);
    },
    unregisterAll: () => {
      hookHandlers.clear();
      return rpcCall('hooks.unregisterAll', []);
    },
    list: () => rpcCall('hooks.list', []),
  };

  // ============================================================
  // 消息处理
  // ============================================================
  self.addEventListener('message', async function (event) {
    const msg = event.data;
    if (!msg || typeof msg !== 'object') return;

    switch (msg.type) {
      case 'lifecycle:load':
        await handleLoad(msg.payload);
        break;

      case 'lifecycle:teardown':
        await handleTeardown(msg);
        break;

      case 'rpc:response': {
        const pending = rpcPending.get(msg.id);
        if (!pending) return;
        rpcPending.delete(msg.id);
        if (msg.payload && msg.payload.error) {
          pending.reject(new Error(msg.payload.error));
        } else {
          pending.resolve(msg.payload ? msg.payload.result : undefined);
        }
        break;
      }

      case 'hook:trigger':
        await handleHookTrigger(msg);
        break;

      case 'event:emit': {
        const eventName = msg.payload && msg.payload.event;
        const args = (msg.payload && msg.payload.args) || [];
        const set = eventHandlers.get(eventName);
        if (set) {
          const handlers = Array.from(set);
          for (let i = 0; i < handlers.length; i++) {
            try {
              await handlers[i].apply(null, args);
            } catch (err) {
              console.error('[Worker] 事件 ' + eventName + ' 处理失败:', err);
            }
          }
        }
        break;
      }

      case 'ui:message':
        // UI → Worker 消息（保留通道，暂不处理）
        break;

      default:
        // 未识别消息，忽略
        break;
    }
  });

  // ============================================================
  // 生命周期：加载
  // ============================================================
  async function handleLoad(payload) {
    const m = payload.manifest;
    const entryUrl = payload.entryUrl;
    manifest = m;
    self.__manifest__ = m;

    try {
      const mod = await import(entryUrl);
      const plugin = mod.default || mod;

      if (typeof plugin !== 'object' || plugin === null) {
        throw new Error('插件 main.js 必须导出对象');
      }
      if (typeof plugin.setup !== 'function') {
        throw new Error('插件必须导出 setup(api, manifest) 函数');
      }

      pluginInstance = plugin;
      self.__plugin__ = plugin;

      const result = await plugin.setup(api, m);

      // 支持两种 teardown 返回形式
      if (typeof result === 'function') {
        teardownFn = result;
      } else if (typeof plugin.teardown === 'function') {
        teardownFn = plugin.teardown.bind(plugin);
      }

      self.postMessage({ type: 'plugin:ready' });
    } catch (err) {
      self.postMessage({
        type: 'plugin:error',
        payload: {
          error: err && err.message ? err.message : String(err),
          stack: (err && err.stack) || '',
        },
      });
    }
  }

  // ============================================================
  // 生命周期：卸载
  // ============================================================
  async function handleTeardown(msg) {
    let error = null;
    try {
      if (typeof teardownFn === 'function') {
        await teardownFn();
      }
      teardownFn = null;
      pluginInstance = null;
      hookHandlers.clear();
      eventHandlers.clear();
      // 清理 rpcPending，拒绝所有等待中的请求
      for (const p of rpcPending.values()) {
        try { p.reject(new Error('插件已卸载')); } catch (_) {}
      }
      rpcPending.clear();
    } catch (err) {
      error = err && err.message ? err.message : String(err);
    }
    self.postMessage({
      id: msg.id,
      type: 'lifecycle:teardown-done',
      payload: error ? { error } : {},
    });
  }

  // ============================================================
  // 钩子触发
  // ============================================================
  async function handleHookTrigger(msg) {
    const hookName = msg.payload.hookName;
    const context = msg.payload.context;
    const meta = msg.payload.meta;
    const handler = hookHandlers.get(hookName);

    if (!handler) {
      self.postMessage({
        id: msg.id,
        type: 'hook:result',
        payload: { result: undefined },
      });
      return;
    }

    try {
      const result = await handler(context, meta);
      self.postMessage({
        id: msg.id,
        type: 'hook:result',
        payload: { result },
      });
    } catch (err) {
      self.postMessage({
        id: msg.id,
        type: 'hook:result',
        payload: { error: err && err.message ? err.message : String(err) },
      });
    }
  }

  // ============================================================
  // 全局错误捕获
  // ============================================================
  self.addEventListener('error', function (e) {
    console.error('[Worker] 未捕获错误:', e.message);
    log('error', e.message || 'Unknown worker error');
  });

  self.addEventListener('unhandledrejection', function (e) {
    console.error('[Worker] 未处理的 Promise 拒绝:', e.reason);
    log('error', String((e.reason && e.reason.message) || e.reason));
  });
}

// ============================================================
// 生成 Worker 注入代码
// ============================================================

/**
 * 返回可注入到 Worker 的运行时源代码
 *
 * @returns {string}
 */
export function getWorkerRuntimeCode() {
  const fnStr = _workerRuntimeMain.toString();
  const placeholder = '__UTOPIA_MODULE_NAMES__';

  if (!fnStr.includes(placeholder)) {
    // 开发期安全网：确保占位符存在，否则意味着 _workerRuntimeMain 被意外修改
    throw new Error(
      '[WorkerRuntime] 占位符丢失：_workerRuntimeMain 内未找到 __UTOPIA_MODULE_NAMES__。' +
      '这不应该发生，请检查 workerRuntime.js 是否被误改。'
    );
  }

  const moduleNames = [
    ...Object.keys(ModulesIndex),
    'api',
    'db',
    'utils',
    'tts',
    'stt',
  ];

  const uniqueNames = [...new Set(moduleNames)];

  const replaced = fnStr.replace(
    new RegExp(placeholder, 'g'),
    JSON.stringify(uniqueNames)
  );

  return '(' + replaced + ')();';
}