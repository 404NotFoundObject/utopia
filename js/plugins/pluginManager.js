/**
 * @module plugins/pluginManager
 * @description 插件生命周期管理
 *
 * 职责：
 *   - 初始化插件系统（加载已启用的插件）
 *   - 启用/禁用/重载插件
 *   - 协调 VFS、Runtime、UIBridge、UIRuntime 四者
 */

import {
  getPlugin,
  getAllPlugins,
  getEnabledPlugins,
  setPluginEnabled,
} from './pluginVfs.js';
import {
  createPluginWorker,
  terminatePluginWorker,
} from './pluginRuntime.js';
import { loadUiScript, unregisterAllInjections } from './uiBridge.js';
import { unregisterAllHooks } from './hookSystem.js';
import { cleanupPluginEventSubscriptions } from './pluginApi.js';
import { startUIRuntime, stopUIRuntime } from './uiRuntime.js';
import { showToast } from '../ui/components/toast.js';
import globalEventBus from '../core/eventBus.js';

// ============================================================
// 状态
// ============================================================

// pluginId -> { manifest, worker, ui, startedAt }
const runningPlugins = new Map();

// ============================================================
// 初始化
// ============================================================

/**
 * 初始化插件系统：加载所有已启用的插件
 */
export async function initPluginSystem() {
  console.log('[PluginManager] 初始化插件系统...');

  // ★ 启动 UI 槽位系统（监听 DOM 变化）
  try {
    startUIRuntime();
  } catch (err) {
    console.warn('[PluginManager] UI 运行时启动失败:', err);
  }

  let enabled = [];
  try {
    enabled = await getEnabledPlugins();
  } catch (err) {
    console.warn('[PluginManager] 读取已启用插件失败:', err);
    return;
  }

  console.log('[PluginManager] 发现 ' + enabled.length + ' 个已启用插件');

  for (const record of enabled) {
    try {
      await enablePlugin(record.id, { silent: true });
    } catch (err) {
      console.error('[PluginManager] 加载插件 ' + record.id + ' 失败:', err);
    }
  }

  console.log('[PluginManager] 就绪，运行中: ' + runningPlugins.size);
}

/**
 * 关闭插件系统（应用卸载时调用）
 */
export async function shutdownPluginSystem() {
  // 停用所有运行中的插件
  for (const pluginId of Array.from(runningPlugins.keys())) {
    try {
      await disablePlugin(pluginId, { silent: true });
    } catch (err) {
      console.warn('[PluginManager] 停用插件 ' + pluginId + ' 失败:', err);
    }
  }

  // 停止 UI 运行时
  try {
    stopUIRuntime();
  } catch (err) {
    console.warn('[PluginManager] UI 运行时停止失败:', err);
  }

  console.log('[PluginManager] 已关闭');
}

// ============================================================
// 启用
// ============================================================

/**
 * 启用插件
 */
export async function enablePlugin(pluginId, opts = {}) {
  const silent = !!opts.silent;

  // 已运行则跳过
  if (runningPlugins.has(pluginId)) {
    return runningPlugins.get(pluginId);
  }

  // 读取元数据
  const record = await getPlugin(pluginId);
  if (!record) {
    throw new Error('插件不存在: ' + pluginId);
  }

  const manifest = record.manifest;

  // ---- 1. 创建 Worker ----
  console.log('[PluginManager] 启动 Worker: ' + manifest.name + ' v' + manifest.version);
  let worker;
  try {
    worker = await createPluginWorker(manifest);
  } catch (err) {
    console.error('[PluginManager] Worker 创建失败:', err.message);
    throw err;
  }

  // ---- 2. 加载 UI 脚本（可选） ----
  let ui = null;
  if (manifest.ui) {
    try {
      ui = await loadUiScript(manifest);
      console.log('[PluginManager] ✅ UI 脚本已加载: ' + manifest.name);
    } catch (err) {
      console.error('[PluginManager] UI 脚本加载失败: ' + manifest.name, err);
      // UI 加载失败不阻止插件启用
    }
  }

  // ---- 3. 记录运行状态 ----
  runningPlugins.set(pluginId, {
    manifest,
    worker,
    ui,
    startedAt: Date.now(),
  });

  // ---- 4. 更新 VFS 状态 ----
  if (!record.enabled) {
    try {
      await setPluginEnabled(pluginId, true);
    } catch (err) {
      console.warn('[PluginManager] 更新启用状态失败:', err);
    }
  }

  console.log('[PluginManager] ✅ 插件已启用: ' + manifest.name);

  if (!silent) {
    showToast('插件 "' + manifest.name + '" 已启用', 'success');
  }

  globalEventBus.emit('plugin:enabled', {
    pluginId,
    manifest,
    timestamp: Date.now(),
  });

  return runningPlugins.get(pluginId);
}

/**
 * 禁用插件
 */
export async function disablePlugin(pluginId, opts = {}) {
  const silent = !!opts.silent;

  const state = runningPlugins.get(pluginId);
  if (!state) {
    // 未运行，尝试更新 VFS 状态
    try {
      await setPluginEnabled(pluginId, false);
    } catch (_) {}
    return false;
  }

  const manifest = state.manifest;
  const ui = state.ui;

  // ---- 1. 调用 UI teardown ----
  if (ui && typeof ui.teardown === 'function') {
    try {
      await ui.teardown();
    } catch (err) {
      console.warn('[PluginManager] UI teardown 失败: ' + pluginId, err);
    }
  }

  if (ui && typeof ui._cleanup === 'function') {
    try {
      ui._cleanup();
    } catch (err) {
      console.warn('[PluginManager] UI cleanup 失败: ' + pluginId, err);
    }
  }

  // ---- 2. 清理 UI 注入（含槽位） ----
  unregisterAllInjections(pluginId);

  // ---- 3. 清理钩子 ----
  unregisterAllHooks(pluginId);

  // ---- 4. 清理事件订阅 ----
  cleanupPluginEventSubscriptions(pluginId);

  // ---- 5. 终止 Worker ----
  await terminatePluginWorker(pluginId);

  // ---- 6. 更新 VFS 状态 ----
  try {
    await setPluginEnabled(pluginId, false);
  } catch (_) {}

  runningPlugins.delete(pluginId);

  console.log('[PluginManager] 🛑 插件已禁用: ' + manifest.name);

  if (!silent) {
    showToast('插件 "' + manifest.name + '" 已禁用', 'info');
  }

  globalEventBus.emit('plugin:disabled', {
    pluginId,
    timestamp: Date.now(),
  });

  return true;
}

// ============================================================
// 重载
// ============================================================

/**
 * 重载插件
 */
export async function reloadPlugin(pluginId) {
  const state = runningPlugins.get(pluginId);
  const wasEnabled = !!state;

  if (wasEnabled) {
    await disablePlugin(pluginId, { silent: true });
    await enablePlugin(pluginId, { silent: true });
    showToast('插件已重载', 'success');
  } else {
    await enablePlugin(pluginId);
  }
  return true;
}

// ============================================================
// 查询
// ============================================================

/**
 * 获取所有已安装插件（含未启用）
 */
export async function listInstalledPlugins() {
  const all = await getAllPlugins();
  return all.map(record => ({
    id: record.id,
    name: record.manifest.name,
    version: record.manifest.version,
    description: record.manifest.description,
    author: record.manifest.author,
    permissions: record.manifest.permissions || [],
    enabled: record.enabled,
    running: runningPlugins.has(record.id),
    installedAt: record.installedAt,
    updatedAt: record.updatedAt,
    source: record.source,
    sourceUrl: record.sourceUrl,
  }));
}

/**
 * 获取所有运行中的插件
 */
export function listRunningPlugins() {
  const result = [];
  for (const [id, state] of runningPlugins.entries()) {
    result.push({
      id,
      name: state.manifest.name,
      version: state.manifest.version,
      startedAt: state.startedAt,
      hasUi: !!state.ui,
    });
  }
  return result;
}

/**
 * 获取单个插件的运行状态
 */
export function getPluginRuntime(pluginId) {
  return runningPlugins.get(pluginId) || null;
}

/**
 * 检查插件是否运行中
 */
export function isPluginRunning(pluginId) {
  return runningPlugins.has(pluginId);
}

// ============================================================
// 全局调试 API
// ============================================================

/**
 * 挂载到 window，方便控制台调试
 */
export function attachGlobalDebugApi() {
  if (typeof window === 'undefined') return;

  window.__utopiaPlugins = {
    list: listInstalledPlugins,
    running: listRunningPlugins,
    enable: (id) => enablePlugin(id),
    disable: (id) => disablePlugin(id),
    reload: (id) => reloadPlugin(id),

    // 钩子
    hooks: async () => {
      const { listHooks } = await import('./hookSystem.js');
      return listHooks();
    },

    // UI 槽位
    slots: async () => {
      const { listSlots, listRenderers, rescan } = await import('./uiRuntime.js');
      return {
        slots: listSlots(),
        renderers: listRenderers(),
        rescan,   // 手动触发全量扫描
      };
    },

    // API 方法列表
    api: async () => {
      const { listApiMethods } = await import('./pluginApi.js');
      return listApiMethods();
    },

    runtime: getPluginRuntime,
    isRunning: isPluginRunning,
  };

  console.log('[PluginManager] 已挂载调试 API: window.__utopiaPlugins');
}