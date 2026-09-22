/**
 * @module plugins/uiBridge
 * @description UI 注入代理
 *
 * 职责：
 *   - 从 VFS 加载插件的 ui.js（支持递归导入重写）
 *   - 创建 uiApi 供 ui.js 使用（含 scoped API + 全套便捷接口）
 *   - 桥接 uiRuntime（槽位系统）
 *   - 转发 Worker ↔ UI 的消息
 *
 * 集成的便捷 API：
 *   - 第 1 轮：storage / config
 *   - 第 2 轮：dialog / logger / dom / hotkey
 *   - 第 3 轮：contextMenu / tooltip / loading / dragDrop
 *
 */

import { getPluginFiles } from './pluginVfs.js';
import { onWorkerCustomMessage, postToWorker } from './pluginRuntime.js';
import { manifestHasPermission, getRequiredPermission } from './permissionChecker.js';
import { UtopiaApi } from './pluginApi.js';
import * as hookSystem from './hookSystem.js';
import globalEventBus from '../core/eventBus.js';
import * as contextMenuRegistry from '../ui/components/contextMenuRegistry.js';

import {
  registerSlot,
  unregisterSlot,
  unregisterAllSlots,
  overrideRenderer,
  unregisterRenderer,
  unregisterAllRenderers,
} from './uiRuntime.js';

// ============================================================
// 便捷 API 工厂
// ============================================================

import { createPluginStorage } from './pluginStorage.js';
import { createPluginConfig } from './pluginConfig.js';
import { createPluginDialog } from './pluginDialog.js';
import { createPluginLogger } from './pluginLogger.js';
import { createPluginDom } from './pluginDom.js';
import { createPluginHotkey } from './pluginHotkey.js';
import { createPluginContextMenu } from './pluginContextMenu.js';
import { createPluginTooltip } from './pluginTooltip.js';
import { createPluginLoading } from './pluginLoading.js';
import { createPluginDragDrop } from './pluginDragDrop.js';

// ============================================================
// 兼容层：旧注入注册表
// ============================================================

const injections = {
  panels: new Map(),
  messageActions: new Map(),
  settingsSections: new Map(),
  sidebarButtons: new Map(),
};

const changeListeners = new Set();

function notifyChange(type, action, data) {
  for (const listener of changeListeners) {
    try {
      listener({ type, action, data });
    } catch (err) {
      console.error('[UIBridge] 通知监听器失败:', err);
    }
  }
}

export function onUiChange(callback) {
  changeListeners.add(callback);
  return () => changeListeners.delete(callback);
}

// ============================================================
// 全局实例注册表（用于插件卸载时清理）
// ============================================================

const hotkeyInstances = new Map();       // pluginId -> hotkeyInstance
const loadingInstances = new Map();      // pluginId -> loadingInstance
const configChangeUnsubscribers = new Map();   // pluginId -> Set<unsubscribe>

// ============================================================
// ★ Scoped API：为 ui.js 提供带权限校验的 API 代理
// ============================================================

/**
 * 创建 scoped API
 *
 * 与 Worker 侧的 api 保持一致：
 *   - hooks.register(hookName, opts) 自动注入 pluginId
 *   - 所有方法调用前进行权限校验
 */
function createScopedApi(pluginId, manifest) {
  function requirePermission(perm) {
    if (!perm) return;
    if (perm === '__unknown__') return;   // 未知方法在下面单独处理
    if (!manifestHasPermission(manifest, perm)) {
      throw new Error(`插件 "${manifest.name}" 缺少权限: ${perm}`);
    }
  }

  return new Proxy(UtopiaApi, {
    get(target, moduleName) {
      // 元信息
      if (moduleName === 'apiVersion' || moduleName === 'utopiaVersion') {
        return target[moduleName];
      }

      // ---- hooks 特殊处理：自动注入 pluginId ----
      if (moduleName === 'hooks') {
        return {
          register: (hookName, opts = {}) => {
            requirePermission('hook:register');
            return hookSystem.registerHook(pluginId, hookName, opts);
          },
          unregister: (hookName) => hookSystem.unregisterHook(pluginId, hookName),
          unregisterAll: () => hookSystem.unregisterAllHooks(pluginId),
          list: () => hookSystem.listHooks(),
        };
      }

      const originalModule = target[moduleName];
      if (!originalModule || typeof originalModule !== 'object') {
        return originalModule;
      }

      // ---- 其他模块：权限校验代理 ----
      return new Proxy(originalModule, {
        get(mod, methodName) {
          const fn = mod[methodName];
          if (typeof fn !== 'function') return fn;

          return (...args) => {
            const fullPath = `${moduleName}.${methodName}`;
            const perm = getRequiredPermission(fullPath);

            if (perm === null) {
              // 无需权限
            } else if (perm === '__unknown__') {
              // 未声明的方法：只有 '*' 权限才允许
              if (!manifestHasPermission(manifest, '*')) {
                throw new Error(
                  `插件 "${manifest.name}" 试图调用未授权的 API: ${fullPath}`
                );
              }
            } else {
              requirePermission(perm);
            }

            return fn.apply(mod, args);
          };
        },
      });
    },
  });
}

// ============================================================
// uiApi 工厂
// ============================================================

export function createUiApi(pluginId, manifest) {
  function requirePermission(perm) {
    if (!manifestHasPermission(manifest, perm)) {
      throw new Error('插件 "' + manifest.name + '" 缺少权限: ' + perm);
    }
  }

  function key(id) {
    return pluginId + ':' + id;
  }

  // ---- 创建单例实例（用于卸载时清理） ----
  const hotkeyInstance = createPluginHotkey(pluginId);
  hotkeyInstances.set(pluginId, hotkeyInstance);

  const loadingInstance = createPluginLoading(pluginId);
  loadingInstances.set(pluginId, loadingInstance);

  return {
    // ============================================================
    // 主线程侧 API（带权限校验）
    // ============================================================
    api: createScopedApi(pluginId, manifest),

    // ============================================================
    // ★ 持久化存储与配置（第 1 轮）
    // ============================================================
    storage: createPluginStorage(pluginId),
    config: createPluginConfig(pluginId, {}, {
      subscribe: (event, cb) => {
        const unsub = globalEventBus.on(event, cb);
        if (!configChangeUnsubscribers.has(pluginId)) {
          configChangeUnsubscribers.set(pluginId, new Set());
        }
        configChangeUnsubscribers.get(pluginId).add(unsub);
        // 返回包装后的取消函数：既取消订阅，也从追踪容器中移除
        return () => {
          try { unsub(); } catch (_) {}
          const set = configChangeUnsubscribers.get(pluginId);
          if (set) {
            set.delete(unsub);
            if (set.size === 0) configChangeUnsubscribers.delete(pluginId);
          }
        };
      },
    }),

    // ============================================================
    // ★ 便捷工具（第 2 轮）
    // ============================================================
    dialog: createPluginDialog(pluginId, manifest),
    logger: createPluginLogger(pluginId, manifest.name),
    dom: createPluginDom(),
    hotkey: hotkeyInstance,

    // ============================================================
    // ★ UI 增强（第 3 轮）
    // ============================================================
    contextMenu: createPluginContextMenu(pluginId),
    tooltip: createPluginTooltip(pluginId),
    loading: loadingInstance,
    dragDrop: createPluginDragDrop(pluginId),

    // ============================================================
    // 模态框接口
    // ============================================================
    modal: {
      open: (htmlContent, onClose) => {
        return import('../ui/components/modal.js').then(m => m.openModal(htmlContent, onClose));
      },
      close: () => {
        return import('../ui/components/modal.js').then(m => m.closeModal());
      },
      create: (title, bodyHtml, footerHtml) => {
        return import('../ui/components/modal.js').then(m => m.createModal(title, bodyHtml, footerHtml));
      },
    },

    // ============================================================
    // 常用工具（无需导入即可用）
    // ============================================================
    utils: {
      showToast: (msg, type = 'info', duration = 3000) => {
        return import('../ui/components/toast.js').then(m => m.showToast(msg, type, duration));
      },
      showBanner: (text, duration = 3000, type = 'info') => {
        return import('../ui/components/banner.js').then(m => m.showBanner(text, duration, type));
      },
      renderMarkdown: (text) => {
        return import('../ui/components/markdown.js').then(m => m.renderMarkdown(text));
      },
      formatTime: (ts) => {
        return import('../core/utils.js').then(m => m.formatTime(ts));
      },
      escapeHtml: (text) => {
        const div = document.createElement('div');
        div.textContent = String(text == null ? '' : text);
        return div.innerHTML;
      },
      generateUUID: () => {
        return import('../core/utils.js').then(m => m.generateUUID());
      },
    },

    // ============================================================
    // 通用模块加载器（绕过 Blob URL 限制）
    // ============================================================
    loadModule: async (path) => {
      if (typeof path !== 'string' || !path) {
        throw new Error('loadModule: path 必须是非空字符串');
      }
      const normalized = (path.startsWith('/js/') || path.startsWith('http'))
        ? path
        : '/js/' + path.replace(/^\/+/, '');
      return import(/* @vite-ignore */ normalized);
    },

    // ============================================================
    // 槽位系统
    // ============================================================
    registerSlot: (slotName, renderFn, opts = {}) => {
      requirePermission('ui:inject');
      registerSlot(pluginId, slotName, renderFn, opts);
      return () => unregisterSlot(pluginId, slotName);
    },

    overrideRenderer: (slotName, overrideFn, opts = {}) => {
      requirePermission('ui:inject');
      overrideRenderer(pluginId, slotName, overrideFn, opts);
      return () => unregisterRenderer(pluginId, slotName);
    },

    // ============================================================
    // 兼容 API（旧插件）
    // ============================================================
    injectPanel: (config) => {
      requirePermission('ui:inject');
      if (!config || !config.id || typeof config.render !== 'function') {
        throw new Error('injectPanel 需要 id 和 render 函数');
      }
      const k = key(config.id);
      injections.panels.set(k, { pluginId, config });
      notifyChange('panel', 'add', { pluginId, config });
      return () => {
        injections.panels.delete(k);
        notifyChange('panel', 'remove', { pluginId, config });
      };
    },

    injectMessageAction: (config) => {
      requirePermission('ui:inject');
      if (!config || !config.id || typeof config.onClick !== 'function') {
        throw new Error('injectMessageAction 需要 id 和 onClick 函数');
      }
      const k = key(config.id);
      injections.messageActions.set(k, { pluginId, config });
      notifyChange('messageAction', 'add', { pluginId, config });
      return () => {
        injections.messageActions.delete(k);
        notifyChange('messageAction', 'remove', { pluginId, config });
      };
    },

    injectSettingsSection: (config) => {
      requirePermission('ui:inject');
      if (!config || !config.id || typeof config.render !== 'function') {
        throw new Error('injectSettingsSection 需要 id 和 render 函数');
      }
      const k = key(config.id);
      injections.settingsSections.set(k, { pluginId, config });
      notifyChange('settingsSection', 'add', { pluginId, config });
      return () => {
        injections.settingsSections.delete(k);
        notifyChange('settingsSection', 'remove', { pluginId, config });
      };
    },

    injectSidebarButton: (config) => {
      requirePermission('ui:inject');
      if (!config || !config.id || typeof config.onClick !== 'function') {
        throw new Error('injectSidebarButton 需要 id 和 onClick 函数');
      }
      const k = key(config.id);
      injections.sidebarButtons.set(k, { pluginId, config });
      notifyChange('sidebarButton', 'add', { pluginId, config });
      return () => {
        injections.sidebarButtons.delete(k);
        notifyChange('sidebarButton', 'remove', { pluginId, config });
      };
    },

    // ============================================================
    // Worker 通信
    // ============================================================
    onWorkerMessage: (callback) => {
      return onWorkerCustomMessage(pluginId, callback);
    },

    sendToWorker: (msg) => {
      return postToWorker(pluginId, { type: 'ui:message', payload: msg });
    },
  };
}

// ============================================================
// UI 脚本加载（含递归导入重写）
// ============================================================

export async function loadUiScript(manifest) {
  if (!manifest.ui) return null;

  const files = await getPluginFiles(manifest.id);
  if (!files || Object.keys(files).length === 0) {
    throw new Error('插件 ' + manifest.id + ' 的文件为空');
  }

  const resolvedUrls = new Map();
  const stack = new Set();

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
    if (!/\.[a-z0-9]+$/i.test(resolved)) resolved += '.js';
    return resolved;
  }

  function decodeContent(content) {
    if (typeof content === 'string') return content;
    return new TextDecoder('utf-8').decode(content);
  }

  function processFile(path) {
    if (resolvedUrls.has(path)) return resolvedUrls.get(path);
    if (stack.has(path)) {
      throw new Error('UI 脚本循环导入: ' + Array.from(stack).concat([path]).join(' → '));
    }
    const content = files[path];
    if (!content) return null;

    stack.add(path);
    let code = decodeContent(content);
    const dir = path.includes('/') ? path.substring(0, path.lastIndexOf('/')) : '';

    // 递归重写相对导入
    code = code.replace(
      /(\bfrom\s*['"]|\bimport\s*\(\s*['"]|\bimport\s+['"])(\.\.?\/[^'"]+)(['"])/g,
      function (match, prefix, importPath, suffix) {
        const resolved = resolvePath(dir, importPath);
        const url = processFile(resolved);
        return url ? (prefix + url + suffix) : match;
      }
    );

    const blob = new Blob([code], { type: 'application/javascript' });
    const url = URL.createObjectURL(blob);
    resolvedUrls.set(path, url);
    stack.delete(path);
    return url;
  }

  const uiUrl = processFile(manifest.ui);
  if (!uiUrl) {
    throw new Error('UI 文件不存在: ' + manifest.ui);
  }

  try {
    const mod = await import(/* @vite-ignore */ uiUrl);
    const uiModule = mod.default || mod;

    if (typeof uiModule !== 'object' || uiModule === null) {
      throw new Error('ui.js 必须导出对象');
    }
    if (typeof uiModule.setup !== 'function') {
      throw new Error('ui.js 必须导出 setup 函数');
    }

    const uiApi = createUiApi(manifest.id, manifest);
    const teardown = await uiModule.setup(uiApi, manifest);

    return {
      uiModule,
      uiApi,
      teardown: typeof teardown === 'function' ? teardown : null,
      _cleanup: () => {
        for (const url of resolvedUrls.values()) {
          try { URL.revokeObjectURL(url); } catch (_) {}
        }
      },
    };
  } catch (err) {
    for (const url of resolvedUrls.values()) {
      try { URL.revokeObjectURL(url); } catch (_) {}
    }
    throw err;
  }
}

// ============================================================
// 清理
// ============================================================

export function unregisterAllInjections(pluginId) {
  const prefix = pluginId + ':';

  // ---- 1. 清旧注册表 ----
  for (const key of Array.from(injections.panels.keys())) {
    if (key.startsWith(prefix)) injections.panels.delete(key);
  }
  for (const key of Array.from(injections.messageActions.keys())) {
    if (key.startsWith(prefix)) injections.messageActions.delete(key);
  }
  for (const key of Array.from(injections.settingsSections.keys())) {
    if (key.startsWith(prefix)) injections.settingsSections.delete(key);
  }
  for (const key of Array.from(injections.sidebarButtons.keys())) {
    if (key.startsWith(prefix)) injections.sidebarButtons.delete(key);
  }

  // ---- 2. 清槽位系统 ----
  unregisterAllSlots(pluginId);
  unregisterAllRenderers(pluginId);

  // ---- 3. 清 hotkey 实例 ----
  const hotkeyInstance = hotkeyInstances.get(pluginId);
  if (hotkeyInstance) {
    try { hotkeyInstance.unregisterAll(); } catch (_) {}
    hotkeyInstances.delete(pluginId);
  }

  // ---- 4. 清 loading 实例（防止遮罩卡住） ----
  const loadingInstance = loadingInstances.get(pluginId);
  if (loadingInstance) {
    try { loadingInstance.reset(); } catch (_) {}
    loadingInstances.delete(pluginId);
  }

  const cfgUnsubs = configChangeUnsubscribers.get(pluginId);
  if (cfgUnsubs) {
    for (const unsub of cfgUnsubs) {
      try { unsub(); } catch (_) {}
    }
    configChangeUnsubscribers.delete(pluginId);
  }

  try {
    const removed = contextMenuRegistry.unregisterByPlugin(pluginId);
    if (removed > 0) {
      console.debug(`[UIBridge] 已清理 ${pluginId} 的 ${removed} 个右键菜单 provider`);
    }
  } catch (err) {
    console.warn('[UIBridge] 清理 contextMenu 失败:', err);
  }

  notifyChange('all', 'clear', { pluginId });
}

// ============================================================
// 供 UI 组件查询（兼容层）
// ============================================================

export function getInjectedPanels() {
  return Array.from(injections.panels.values());
}

export function getInjectedMessageActions() {
  return Array.from(injections.messageActions.values());
}

export function getInjectedSettingsSections() {
  return Array.from(injections.settingsSections.values());
}

export function getInjectedSidebarButtons() {
  return Array.from(injections.sidebarButtons.values());
}