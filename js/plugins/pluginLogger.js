/**
 * @module plugins/pluginLogger
 * @description 命名空间日志
 *
 * 特性：
 *   - 自动添加插件前缀
 *   - 支持 debug / info / warn / error 四个级别
 *   - 支持全局日志级别控制
 *   - 输出同时转发到控制台
 *
 * 全局级别设置：
 *   通过 localStorage 的 `utopia:plugin-log-level` 控制
 *   可选值：debug / info / warn / error
 *   默认：info
 */

const LOG_LEVELS = { debug: 0, info: 1, warn: 2, error: 3 };
const STORAGE_KEY = 'utopia:plugin-log-level';

/**
 * 获取全局日志级别
 */
function getGlobalLevel() {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored && stored in LOG_LEVELS) return LOG_LEVELS[stored];
  } catch (_) {}
  return LOG_LEVELS.info;
}

/**
 * 为某插件创建 logger
 * @param {string} pluginId
 * @param {string} pluginName
 * @returns {Object}
 */
export function createPluginLogger(pluginId, pluginName) {
  const prefix = `[${pluginName || pluginId}]`;

  function shouldLog(level) {
    return LOG_LEVELS[level] >= getGlobalLevel();
  }

  return {
    /**
     * 调试日志（默认不输出）
     */
    debug(...args) {
      if (!shouldLog('debug')) return;
      console.debug(prefix, ...args);
    },

    /**
     * 普通信息
     */
    info(...args) {
      if (!shouldLog('info')) return;
      console.log(prefix, ...args);
    },

    /**
     * 警告
     */
    warn(...args) {
      if (!shouldLog('warn')) return;
      console.warn(prefix, ...args);
    },

    /**
     * 错误
     */
    error(...args) {
      if (!shouldLog('error')) return;
      console.error(prefix, ...args);
    },

    /**
     * 打印对象表格
     */
    table(data) {
      if (!shouldLog('info')) return;
      console.log(prefix);
      console.table(data);
    },

    /**
     * 计时器
     *
     *
     *
     * @param {string} label
     * @returns {Function} stop 函数，调用后返回自 time() 调用以来的毫秒数
     */
    time(label) {
      const start = performance.now();
      const fullLabel = `${prefix} ${label}`;
      const shouldPrint = shouldLog('debug');

      if (shouldPrint) console.time(fullLabel);

      return () => {
        const elapsed = performance.now() - start;
        if (shouldPrint) console.timeEnd(fullLabel);
        return elapsed;
      };
    },

    /**
     * 获取插件前缀（供高级用途）
     */
    getPrefix() {
      return prefix;
    },
  };
}

/**
 * 设置全局日志级别
 * @param {'debug'|'info'|'warn'|'error'} level
 */
export function setGlobalLogLevel(level) {
  if (!(level in LOG_LEVELS)) {
    throw new Error(`无效的日志级别: ${level}。可选：${Object.keys(LOG_LEVELS).join(', ')}`);
  }
  try {
    localStorage.setItem(STORAGE_KEY, level);
  } catch (_) {}
}

/**
 * 获取当前全局日志级别
 */
export function getGlobalLogLevel() {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored && stored in LOG_LEVELS) return stored;
  } catch (_) {}
  return 'info';
}