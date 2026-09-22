/**
 * @module plugins/pluginConfig
 * @description 插件配置管理
 *
 * 特性：
 *   - 基于 pluginStorage，配置持久化
 *   - 默认值合并
 *   - 变更事件通知
 *   - 重置为默认值
 *
 * 存储格式：
 *   KV key: "__config__"
 *   value:  { ...用户配置 }
 *
 */

import { kvGet, kvSet } from './pluginVfs.js';
import globalEventBus from '../core/eventBus.js';

const CONFIG_KEY = '__config__';

/**
 * 为某插件创建 config 对象
 *
 * @param {string} pluginId
 * @param {Object} [defaults={}] - 默认配置
 * @param {Object} [options]
 * @param {Function} [options.subscribe] - (event, callback) => unsubscribe
 *   由调用方（uiBridge）提供，用于按 pluginId 追踪 onChange 监听器。
 *   若不传，回退到 globalEventBus.on（不追踪，插件卸载后可能残留）。
 * @returns {Object}
 */
export function createPluginConfig(pluginId, defaults = {}, options = {}) {
  // 缓存默认值，供 get 使用
  let defaultValues = { ...defaults };

  const subscribeFn = typeof options.subscribe === 'function'
    ? options.subscribe
    : (event, cb) => globalEventBus.on(event, cb);

  return {
    /**
     * 更新默认值（一般用于 onEnable 后动态设置）
     * @param {Object} newDefaults
     */
    setDefaults(newDefaults) {
      defaultValues = { ...defaultValues, ...newDefaults };
    },

    /**
     * 获取配置（与默认值合并）
     * @returns {Promise<Object>}
     */
    async get() {
      const saved = await kvGet(pluginId, CONFIG_KEY) || {};
      return { ...defaultValues, ...saved };
    },

    /**
     * 读取单项
     * @param {string} key
     * @param {*} [fallback] - 覆盖默认值
     */
    async getItem(key, fallback = undefined) {
      const config = await this.get();
      if (key in config) return config[key];
      return fallback !== undefined ? fallback : defaultValues[key];
    },

    /**
     * 设置单项
     */
    async set(key, value) {
      const saved = await kvGet(pluginId, CONFIG_KEY) || {};
      saved[key] = value;
      await kvSet(pluginId, CONFIG_KEY, saved);
      globalEventBus.emit('plugin:config-changed', {
        pluginId,
        key,
        value,
        config: { ...defaultValues, ...saved },
      });
    },

    /**
     * 批量更新
     */
    async update(updates) {
      const saved = await kvGet(pluginId, CONFIG_KEY) || {};
      Object.assign(saved, updates);
      await kvSet(pluginId, CONFIG_KEY, saved);
      globalEventBus.emit('plugin:config-changed', {
        pluginId,
        changes: updates,
        config: { ...defaultValues, ...saved },
      });
    },

    /**
     * 重置为默认值
     */
    async reset() {
      await kvSet(pluginId, CONFIG_KEY, {});
      globalEventBus.emit('plugin:config-changed', {
        pluginId,
        reset: true,
        config: { ...defaultValues },
      });
    },

    /**
     * 订阅配置变更
     * @param {Function} callback - (config, changes) => void
     *   - config:  变更后的完整配置（默认值 + 用户值）
     *   - changes: 增量对象，或 null 表示全量重置
     * @returns {Function} 取消订阅
     */
    onChange(callback) {
      if (typeof callback !== 'function') {
        throw new TypeError('config.onChange: callback 必须是函数');
      }

      return subscribeFn('plugin:config-changed', (payload) => {
        if (payload.pluginId !== pluginId) return;

        // ---- 构造 changes 参数 ----
        let changes;
        if (payload.reset) {
          changes = null;
        } else if (payload.changes !== undefined) {
          // update() 批量变更
          changes = payload.changes;
        } else {
          // set() 单项变更
          changes = { [payload.key]: payload.value };
        }

        callback(payload.config, changes);
      });
    },
  };
}