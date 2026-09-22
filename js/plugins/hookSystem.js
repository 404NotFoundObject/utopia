/**
 * @module plugins/hookSystem
 * @description 主线程钩子注册表和触发器
 *
 * 钩子类型：
 *   - trigger: 旁路型（通知/拦截），插件可修改 context 或返回 false 停止传播
 *   - transform: 值管道型，插件返回值会被传递给下一个插件
 *
 * 钩子命名规范：module:event，如 'chat:before-send'
 *
 * 循环依赖处理：通过回调注入获取 Worker 实例
 */

// ============================================================
// 状态
// ============================================================

// 钩子注册表：Map<hookName, Array<{ pluginId, priority }>>
const hookRegistry = new Map();

// 默认超时
const HOOK_TIMEOUT_MS = 5000;

// Worker 解析函数（由 pluginRuntime 在初始化时注入，避免循环依赖）
let _getWorkerByPluginId = null;

/**
 * 注入 Worker 解析函数
 * 由 pluginManager 或 pluginRuntime 在启动时调用
 */
export function setWorkerResolver(fn) {
  _getWorkerByPluginId = fn;
}

// ============================================================
// 注册 / 注销
// ============================================================

/**
 * 注册钩子
 * @param {string} pluginId
 * @param {string} hookName
 * @param {Object} [opts]
 * @param {number} [opts.priority=100]
 */
export function registerHook(pluginId, hookName, opts = {}) {
  if (!hookName || typeof hookName !== 'string') {
    throw new Error('hookName 必须是非空字符串');
  }
  if (!pluginId) {
    throw new Error('pluginId 不能为空');
  }

  const priority = typeof opts.priority === 'number' ? opts.priority : 100;

  if (!hookRegistry.has(hookName)) hookRegistry.set(hookName, []);
  const list = hookRegistry.get(hookName);

  // 避免重复
  if (list.some(h => h.pluginId === pluginId)) {
    console.debug(`[Hook] ${pluginId} 已注册 ${hookName}，跳过`);
    return;
  }

  list.push({ pluginId, priority });
  list.sort((a, b) => a.priority - b.priority);

  console.debug(`[Hook] ${pluginId} 注册 ${hookName} (priority=${priority})`);
}

/**
 * 注销单个钩子
 */
export function unregisterHook(pluginId, hookName) {
  if (!hookRegistry.has(hookName)) return false;
  const list = hookRegistry.get(hookName);
  const idx = list.findIndex(h => h.pluginId === pluginId);
  if (idx !== -1) {
    list.splice(idx, 1);
    if (list.length === 0) hookRegistry.delete(hookName);
    return true;
  }
  return false;
}

/**
 * 注销某插件的所有钩子
 */
export function unregisterAllHooks(pluginId) {
  let removedCount = 0;
  for (const [hookName, list] of hookRegistry.entries()) {
    for (let i = list.length - 1; i >= 0; i--) {
      if (list[i].pluginId === pluginId) {
        list.splice(i, 1);
        removedCount++;
      }
    }
    if (list.length === 0) hookRegistry.delete(hookName);
  }
  if (removedCount > 0) {
    console.debug(`[Hook] 已清理 ${pluginId} 的 ${removedCount} 个钩子`);
  }
}

/**
 * 列出所有已注册的钩子（调试用）
 */
export function listHooks() {
  const result = {};
  for (const [name, list] of hookRegistry.entries()) {
    result[name] = list.map(h => ({ pluginId: h.pluginId, priority: h.priority }));
  }
  return result;
}

/**
 * 清空（用于测试/重置）
 */
export function clearAllHooks() {
  hookRegistry.clear();
}

// ============================================================
// 触发
// ============================================================

/**
 * 触发 Trigger 型钩子（旁路通知/拦截）
 *
 * @param {string} hookName
 * @param {Object} context
 * @returns {Promise<Object>} 处理后的 context（含 _stopped 标记）
 */
export async function triggerHook(hookName, context = {}) {
  const list = hookRegistry.get(hookName);
  if (!list || list.length === 0) return context;
  if (!_getWorkerByPluginId) {
    console.warn('[Hook] Worker 解析器未注入，无法触发钩子');
    return context;
  }

  let current = { ...context };

  for (const { pluginId } of list) {
    const worker = _getWorkerByPluginId(pluginId);
    if (!worker) continue;

    try {
      const result = await callWorkerHook(worker, hookName, current, pluginId);
      if (result === false) {
        return { ...current, _stopped: true };
      }
      if (result && typeof result === 'object' && result !== current) {
        current = { ...current, ...result };
      }
    } catch (err) {
      console.error(`[Hook] ${hookName} 由 ${pluginId} 执行失败:`, err);
    }
  }

  return current;
}

/**
 * 触发 Transform 型钩子（值管道）
 *
 * @param {string} hookName
 * @param {*} value
 * @param {Object} [meta]
 * @returns {Promise<*>}
 */
export async function transformHook(hookName, value, meta = {}) {
  const list = hookRegistry.get(hookName);
  if (!list || list.length === 0) return value;
  if (!_getWorkerByPluginId) return value;

  let current = value;

  for (const { pluginId } of list) {
    const worker = _getWorkerByPluginId(pluginId);
    if (!worker) continue;

    try {
      const result = await callWorkerHook(worker, hookName, current, pluginId, meta);
      if (result !== undefined) current = result;
    } catch (err) {
      console.error(`[Hook] ${hookName} 由 ${pluginId} 执行失败:`, err);
    }
  }

  return current;
}

// ============================================================
// Worker 调用封装
// ============================================================

function callWorkerHook(worker, hookName, context, pluginId, meta = {}) {
  return new Promise((resolve, reject) => {
    const msgId = `hook_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    const timeout = setTimeout(() => {
      worker.removeEventListener('message', handler);
      reject(new Error(`钩子 ${hookName} 超时（${HOOK_TIMEOUT_MS}ms）`));
    }, HOOK_TIMEOUT_MS);

    const handler = (event) => {
      const data = event.data;
      if (data?.id !== msgId || data?.type !== 'hook:result') return;

      clearTimeout(timeout);
      worker.removeEventListener('message', handler);

      if (data.payload?.error) {
        reject(new Error(data.payload.error));
      } else {
        resolve(data.payload?.result);
      }
    };

    worker.addEventListener('message', handler);
    worker.postMessage({
      id: msgId,
      type: 'hook:trigger',
      payload: {
        hookName,
        context,
        meta: { pluginId, hookName, ...meta },
      },
    });
  });
}