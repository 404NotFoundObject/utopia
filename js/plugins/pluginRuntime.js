/**
 * @module plugins/pluginRuntime
 * @description 主线程侧 Worker 管理和 RPC 路由
 *
 * 职责：
 *   - 从 VFS 文件构建 Worker 入口（递归重写相对导入为 Blob URL）
 *   - 启动/终止插件 Worker
 *   - 处理来自 Worker 的 RPC 请求（权限校验 + 分发）
 *   - 注入 Worker 解析器到 hookSystem
 *   - 转发钩子触发到 Worker
 */

import { getPluginFiles } from './pluginVfs.js';
import { getWorkerRuntimeCode } from './workerRuntime.js';
import { invokeApiMethod } from './pluginApi.js';
import { assertPermission } from './permissionChecker.js';
import { setWorkerResolver } from './hookSystem.js';

// ============================================================
// 状态
// ============================================================

// pluginId -> { worker, manifest, entryUrl, blobUrls, workerUrl, startedAt }
const workers = new Map();

// pluginId -> Promise（就绪信号缓存）
const readyPromises = new Map();

// ============================================================
// 注入 Worker 解析器到 hookSystem（避免循环依赖）
// ============================================================

setWorkerResolver((pluginId) => {
  const state = workers.get(pluginId);
  return state ? state.worker : null;
});

// ============================================================
// 模块包构建（递归重写相对导入）
// ============================================================

/**
 * 从 VFS 文件构建 Worker 入口
 * 将每个 .js 文件转为 Blob URL，递归重写相对导入引用
 *
 * @param {Object} manifest
 * @param {Object} files - { path: Uint8Array | string }
 * @returns {Promise<{ entryUrl: string, blobUrls: Map<string, string> }>}
 */
async function buildModuleBundle(manifest, files) {
  const resolvedUrls = new Map();   // path -> Blob URL
  const stack = new Set();          // 循环导入检测

  /**
   * 解析相对路径
   */
  function resolvePath(dir, importPath) {
    const parts = dir ? dir.split('/').filter(Boolean) : [];
    const segs = importPath.split('/');
    for (let i = 0; i < segs.length; i++) {
      const seg = segs[i];
      if (seg === '.' || seg === '') continue;
      if (seg === '..') parts.pop();
      else parts.push(seg);
    }
    let resolved = parts.join('/');
    // 无扩展名时自动补 .js
    if (!/\.[a-z0-9]+$/i.test(resolved)) {
      resolved += '.js';
    }
    return resolved;
  }

  /**
   * 解码文件内容
   */
  function decodeContent(content) {
    if (typeof content === 'string') return content;
    if (content instanceof Uint8Array || content instanceof ArrayBuffer) {
      return new TextDecoder('utf-8').decode(content);
    }
    if (content && content.buffer) {
      return new TextDecoder('utf-8').decode(content);
    }
    return String(content);
  }

  /**
   * 递归处理文件
   */
  function processFile(path) {
    if (resolvedUrls.has(path)) return resolvedUrls.get(path);
    if (stack.has(path)) {
      throw new Error('检测到循环导入: ' + Array.from(stack).concat([path]).join(' → '));
    }

    const content = files[path];
    if (!content) {
      console.warn('[PluginRuntime] 文件不存在: ' + path);
      return null;
    }

    stack.add(path);

    let code = decodeContent(content);
    const dir = path.includes('/')
      ? path.substring(0, path.lastIndexOf('/'))
      : '';

    // 递归重写相对导入
    // 匹配：from './xxx'、import './xxx'、import('./xxx')
    code = code.replace(
      /(\bfrom\s*['"]|\bimport\s*\(\s*['"]|\bimport\s+['"])(\.\.?\/[^'"]+)(['"])/g,
      function (match, prefix, importPath, suffix) {
        const resolved = resolvePath(dir, importPath);
        const url = processFile(resolved);
        if (url) {
          return prefix + url + suffix;
        }
        console.warn('[PluginRuntime] 无法解析导入: ' + importPath + ' (在 ' + path + ' 中)');
        return match;
      }
    );

    const blob = new Blob([code], { type: 'application/javascript' });
    const url = URL.createObjectURL(blob);
    resolvedUrls.set(path, url);
    stack.delete(path);
    return url;
  }

  const entryUrl = processFile(manifest.main);
  if (!entryUrl) {
    throw new Error('入口文件不存在: ' + manifest.main);
  }

  return { entryUrl, blobUrls: resolvedUrls };
}

// ============================================================
// Worker 生命周期
// ============================================================

/**
 * 创建插件 Worker（等待就绪后 resolve）
 * @param {Object} manifest
 * @returns {Promise<Worker>}
 */
export async function createPluginWorker(manifest) {
  if (workers.has(manifest.id)) {
    throw new Error('插件 ' + manifest.id + ' 的 Worker 已存在');
  }

  // ---- 1. 从 VFS 加载文件 ----
  const files = await getPluginFiles(manifest.id);
  if (!files || Object.keys(files).length === 0) {
    throw new Error('插件 ' + manifest.id + ' 的文件为空');
  }

  // ---- 2. 构建入口 ----
  const bundle = await buildModuleBundle(manifest, files);
  const entryUrl = bundle.entryUrl;
  const blobUrls = bundle.blobUrls;

  // ---- 3. 创建 Worker（先注入运行时胶水） ----
  const runtimeCode = getWorkerRuntimeCode();
  const workerBlob = new Blob([runtimeCode], { type: 'application/javascript' });
  const workerUrl = URL.createObjectURL(workerBlob);

  let worker;
  try {
    worker = new Worker(workerUrl, { type: 'module' });
  } catch (err) {
    // 清理
    URL.revokeObjectURL(workerUrl);
    for (const url of blobUrls.values()) {
      try { URL.revokeObjectURL(url); } catch (_) {}
    }
    throw new Error('创建 Worker 失败: ' + err.message);
  }

  // ---- 4. 注册消息监听 ----
  worker.addEventListener('message', (e) => handleWorkerMessage(manifest.id, e));
  worker.addEventListener('error', (e) => {
    console.error('[PluginRuntime] ' + manifest.id + ' Worker 错误:', e.message || e);
  });
  worker.addEventListener('messageerror', (e) => {
    console.error('[PluginRuntime] ' + manifest.id + ' 消息反序列化失败:', e);
  });

  // ---- 5. 保存状态 ----
  workers.set(manifest.id, {
    worker,
    manifest,
    entryUrl,
    blobUrls,
    workerUrl,
    startedAt: Date.now(),
  });

  // ---- 6. 等待就绪信号 ----
  const readyPromise = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error('插件 ' + manifest.id + ' 加载超时（15s）'));
    }, 15000);

    const handler = (e) => {
      const data = e.data;
      if (!data) return;

      if (data.type === 'plugin:ready') {
        clearTimeout(timeout);
        worker.removeEventListener('message', handler);
        resolve(worker);
      } else if (data.type === 'plugin:error') {
        clearTimeout(timeout);
        worker.removeEventListener('message', handler);
        const errMsg = (data.payload && data.payload.error) || '插件加载失败';
        const err = new Error(errMsg);
        if (data.payload && data.payload.stack) err.stack = data.payload.stack;
        reject(err);
      }
    };
    worker.addEventListener('message', handler);
  });
  readyPromises.set(manifest.id, readyPromise);

  // ---- 7. 发送加载指令 ----
  worker.postMessage({
    type: 'lifecycle:load',
    payload: { manifest, entryUrl },
  });

  try {
    await readyPromise;
    readyPromises.delete(manifest.id);
    return worker;
  } catch (err) {
    terminatePluginWorker(manifest.id);
    readyPromises.delete(manifest.id);
    throw err;
  }
}

/**
 * 终止插件 Worker
 */
export async function terminatePluginWorker(pluginId) {
  const state = workers.get(pluginId);
  if (!state) return false;

  const worker = state.worker;
  const blobUrls = state.blobUrls;
  const workerUrl = state.workerUrl;

  // 通知 Worker 执行 teardown（带超时）
  try {
    await new Promise((resolve) => {
      const id = 'teardown_' + Date.now();
      const timeout = setTimeout(resolve, 3000);
      const handler = (e) => {
        if (e.data && e.data.id === id && e.data.type === 'lifecycle:teardown-done') {
          clearTimeout(timeout);
          worker.removeEventListener('message', handler);
          resolve();
        }
      };
      worker.addEventListener('message', handler);
      worker.postMessage({ id, type: 'lifecycle:teardown' });
    });
  } catch (err) {
    console.warn('[PluginRuntime] ' + pluginId + ' teardown 失败:', err);
  }

  // 终止 Worker
  try { worker.terminate(); } catch (_) {}

  // 释放 Blob URL
  if (blobUrls) {
    for (const url of blobUrls.values()) {
      try { URL.revokeObjectURL(url); } catch (_) {}
    }
  }
  if (workerUrl) {
    try { URL.revokeObjectURL(workerUrl); } catch (_) {}
  }

  workers.delete(pluginId);
  return true;
}

/**
 * 获取某插件的 Worker 实例
 */
export function getWorkerByPluginId(pluginId) {
  const state = workers.get(pluginId);
  return state ? state.worker : null;
}

/**
 * 获取所有运行中的插件 ID
 */
export function getRunningPluginIds() {
  return Array.from(workers.keys());
}

/**
 * 检查插件是否运行中
 */
export function isPluginWorkerRunning(pluginId) {
  return workers.has(pluginId);
}

// ============================================================
// 消息处理（主线程接收 Worker 消息）
// ============================================================

async function handleWorkerMessage(pluginId, event) {
  const data = event.data;
  if (!data || typeof data !== 'object') return;

  const id = data.id;
  const type = data.type;
  const payload = data.payload;

  switch (type) {
    // ---- RPC 请求 ----
    case 'rpc:request': {
      if (!payload || !payload.method) {
        safePostMessage(pluginId, {
          id,
          type: 'rpc:response',
          payload: { error: '缺少 method 参数' },
        });
        return;
      }

      const method = payload.method;
      const args = payload.args || [];

      try {
        // 权限校验
        await assertPermission(pluginId, method);

        // 分发到 API
        const result = await invokeApiMethod(method, args, { pluginId });

        // 序列化并返回
        safePostMessage(pluginId, {
          id,
          type: 'rpc:response',
          payload: { result: serializeForWorker(result) },
        });
      } catch (err) {
        safePostMessage(pluginId, {
          id,
          type: 'rpc:response',
          payload: { error: (err && err.message) || String(err) },
        });
      }
      break;
    }

    // ---- 插件日志 ----
    case 'log': {
      const level = (payload && payload.level) || 'info';
      const message = (payload && payload.message) || '';
      const prefix = '[Plugin:' + pluginId + ']';
      switch (level) {
        case 'debug': console.debug(prefix, message); break;
        case 'warn':  console.warn(prefix, message); break;
        case 'error': console.error(prefix, message); break;
        default:      console.log(prefix, message);
      }
      break;
    }

    case 'plugin:ready':
      console.log('[PluginRuntime] ✅ ' + pluginId + ' 已就绪');
      break;

    case 'plugin:error': {
      console.error('[PluginRuntime] ❌ ' + pluginId + ' 加载失败:', payload && payload.error);
      break;
    }

    // ---- 自定义 UI 消息（转发给 uiBridge 注册的监听器） ----
    case 'ui:message':
      dispatchCustomMessage(pluginId, payload);
      break;

    default:
      console.debug('[PluginRuntime] ' + pluginId + ' 未识别的消息类型: ' + type);
  }
}

// ============================================================
// 序列化工具
// ============================================================

/**
 * 尝试序列化值以传递给 Worker
 * postMessage 使用结构化克隆，函数、DOM、Symbol 会失败
 */
function serializeForWorker(value) {
  if (value === undefined || value === null) return value;
  const t = typeof value;
  if (t === 'function' || t === 'symbol') return null;
  if (t === 'bigint') return Number(value);
  return value;
}

/**
 * 安全 postMessage：捕获结构化克隆失败，尝试 JSON 降级
 */
function safePostMessage(pluginId, msg) {
  const state = workers.get(pluginId);
  if (!state) return;
  try {
    state.worker.postMessage(msg);
  } catch (err) {
    console.warn('[PluginRuntime] ' + pluginId + ' postMessage 失败，尝试 JSON 降级:', err.message);
    try {
      const jsonSafe = JSON.parse(JSON.stringify(msg));
      state.worker.postMessage(jsonSafe);
    } catch (err2) {
      state.worker.postMessage({
        id: msg.id,
        type: msg.type,
        payload: { error: '响应无法序列化' },
      });
    }
  }
}

// ============================================================
// 自定义消息通道（供 UI 使用）
// ============================================================

// pluginId -> Set<callback>
const customMessageListeners = new Map();

/**
 * 订阅来自指定插件的自定义 UI 消息
 */
export function onWorkerCustomMessage(pluginId, callback) {
  if (!customMessageListeners.has(pluginId)) {
    customMessageListeners.set(pluginId, new Set());
  }
  customMessageListeners.get(pluginId).add(callback);
  return () => {
    const set = customMessageListeners.get(pluginId);
    if (set) {
      set.delete(callback);
      if (set.size === 0) customMessageListeners.delete(pluginId);
    }
  };
}

/**
 * 分发自定义消息
 */
function dispatchCustomMessage(pluginId, payload) {
  const listeners = customMessageListeners.get(pluginId);
  if (!listeners) return;
  for (const cb of listeners) {
    try {
      cb(payload);
    } catch (err) {
      console.error('[PluginRuntime] 自定义消息处理失败:', err);
    }
  }
}

/**
 * 主线程 → Worker 发送自定义消息（供 UI 使用）
 */
export function postToWorker(pluginId, message) {
  const state = workers.get(pluginId);
  if (!state) {
    console.warn('[PluginRuntime] 插件 ' + pluginId + ' 未运行');
    return false;
  }
  state.worker.postMessage(message);
  return true;
}