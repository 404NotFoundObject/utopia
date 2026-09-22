/**
 * @module plugins/pluginStorage
 * @description 插件专属持久化存储
 *
 * 特性：
 *   - 每个插件独立命名空间（基于 pluginId 前缀）
 *   - 支持任意可序列化的值（JSON 兼容）
 *   - 前缀筛选 keys
 *   - 卸载插件时自动清理
 */

import { kvGet, kvSet, kvRemove, kvKeys, kvClear } from './pluginVfs.js';

/**
 * 为某插件创建 storage 对象
 * @param {string} pluginId
 * @returns {Object}
 */
export function createPluginStorage(pluginId) {
  return {
    /**
     * 读取值
     * @param {string} key
     * @param {*} [defaultValue] - 不存在时返回的默认值
     * @returns {Promise<*>}
     */
    async get(key, defaultValue = undefined) {
      if (typeof key !== 'string' || !key) {
        throw new Error('storage.get: key 必须是非空字符串');
      }
      const value = await kvGet(pluginId, key);
      return value === undefined ? defaultValue : value;
    },

    /**
     * 写入值
     * @param {string} key
     * @param {*} value - 任意 JSON 可序列化的值
     * @returns {Promise<void>}
     */
    async set(key, value) {
      if (typeof key !== 'string' || !key) {
        throw new Error('storage.set: key 必须是非空字符串');
      }
      // 尝试序列化检查（提前发现不可存储的类型）
      try {
        JSON.stringify(value);
      } catch (err) {
        throw new Error(`storage.set: value 无法序列化（${err.message}）`);
      }
      return kvSet(pluginId, key, value);
    },

    /**
     * 删除值
     * @param {string} key
     * @returns {Promise<void>}
     */
    async remove(key) {
      if (typeof key !== 'string' || !key) {
        throw new Error('storage.remove: key 必须是非空字符串');
      }
      return kvRemove(pluginId, key);
    },

    /**
     * 检查键是否存在
     * @param {string} key
     * @returns {Promise<boolean>}
     */
    async has(key) {
      const value = await kvGet(pluginId, key);
      return value !== undefined;
    },

    /**
     * 获取所有 key（可加前缀）
     * @param {string} [prefix='']
     * @returns {Promise<string[]>}
     */
    async keys(prefix = '') {
      return kvKeys(pluginId, prefix);
    },

    /**
     * 批量读取
     * @param {string[]} keyList
     * @returns {Promise<Object>} 键值对对象
     */
    async getMany(keyList) {
      const result = {};
      for (const k of keyList) {
        result[k] = await kvGet(pluginId, k);
      }
      return result;
    },

    /**
     * 批量写入
     * @param {Object} entries - { key: value }
     * @returns {Promise<void>}
     */
    async setMany(entries) {
      for (const [k, v] of Object.entries(entries)) {
        await kvSet(pluginId, k, v);
      }
    },

    /**
     * 清空该插件的所有数据
     * @returns {Promise<void>}
     */
    async clear() {
      return kvClear(pluginId);
    },
  };
}