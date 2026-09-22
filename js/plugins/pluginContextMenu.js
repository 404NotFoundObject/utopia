/**
 * @module plugins/pluginContextMenu
 * @description 声明式右键菜单（委托给全局 contextMenuRegistry）
 *
 * 用法：
 *   uiApi.contextMenu.register('.message', [
 *     { label: '📋 复制', onClick: (e, target) => {...} },
 *     { separator: true },
 *     { label: '🗑️ 删除', danger: true, onClick: (e, target) => {...} },
 *   ]);
 *
 * 进阶：
 *   opts.exclusive = true  → 该 provider 一旦返回非空 items，其余 provider 不再执行
 *   opts.claim = true      → 该 provider 返回非空 items 后，跳过后续 provider（保留之前已合并的）
 *   opts.priority          → 数字越小越先执行（默认 100）
 *
 */

import * as registry from '../ui/components/contextMenuRegistry.js';

export function createPluginContextMenu(pluginId) {
  const mySelectors = new Set();

  return {
    register(selector, items, opts = {}) {
      if (!selector || typeof selector !== 'string') {
        throw new Error('contextMenu.register: selector 必须是非空字符串');
      }
      if (typeof items !== 'function' && !Array.isArray(items)) {
        throw new Error('contextMenu.register: items 必须是数组或函数');
      }

      const provider = (target, event) => {
        if (typeof items === 'function') {
          try {
            const result = items(target, event);
            return Array.isArray(result) ? result : [];
          } catch (err) {
            console.error(`[PluginContextMenu:${pluginId}] items 函数执行失败:`, err);
            return [];
          }
        }
        return items;
      };

      mySelectors.add(selector);

      return registry.register(selector, provider, {
        priority: typeof opts.priority === 'number' ? opts.priority : 100,
        exclusive: opts.exclusive === true,
        claim: opts.claim === true,
        pluginId,
      });
    },

    close() {
      registry.close();
    },

    show(items, x, y) {
      registry.show(items, x, y);
    },

    list() {
      return Array.from(mySelectors);
    },
  };
}