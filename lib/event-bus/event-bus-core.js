/**
 * @module event-bus/event-bus-core
 * @description 事件总线核心实现，提供发布/订阅、优先级、通配符匹配、粘性事件等功能。
 *
 * @note 粘性事件存储的是参数引用，外部修改对象后，后续新订阅者回放的是修改后的值。
 *       大量通配符订阅时，每次 `emit` 都会遍历所有模式进行正则匹配，可能影响性能（建议控制在百级以内）。
 *       `off` 方法在移除通配符订阅时必须提供正确的回调引用和模式，仅凭事件名可能无法完全移除。
 */

/**
 * 创建一个事件总线实例。
 *
 * @param {Object} [options={}] - 配置项
 * @param {number} [options.historySize=0] - 粘性事件历史记录数量，大于 0 时保留最近 N 次事件，新订阅者立即收到这些历史事件（默认只回放最后一条）。
 * @param {Function} [options.onLog] - 日志回调 `(level, message, data) => void`，用于内部调试日志。
 * @param {Function} [options.onError] - 错误回调 `(error, eventName, subscriber) => void`，当订阅者回调抛出异常时触发。
 * @returns {{
 *   on: Function,
 *   once: Function,
 *   emit: Function,
 *   emitAsync: Function,
 *   off: Function,
 *   clear: Function,
 *   getEventNames: Function,
 *   getSubscribers: Function
 * }} 事件总线实例
 *
 * @example
 * const bus = createEventBus({ historySize: 5, onError: (err, name) => console.error(name, err) });
 *
 * // 普通订阅
 * const unsubscribe = bus.on('user:login', (user) => console.log('登录', user));
 * // 单次订阅
 * bus.once('init', () => console.log('初始化完成'));
 * // 带优先级（数字越小越先执行）
 * bus.on('data', handler, { priority: -10 });
 * // 通配符订阅
 * bus.on('user:*', (eventName, data) => console.log(eventName, data));
 * // 发布事件
 * bus.emit('user:login', { id: 1 });
 * // 异步发布（等待所有订阅者返回的 Promise）
 * await bus.emitAsync('save', data);
 * // 取消订阅
 * unsubscribe(); // 或 bus.off('user:login', handler);
 * // 清除所有事件
 * bus.clear();
 */
function createEventBus(options = {}) {
  const {
    historySize = 0,
    onLog = null,
    onError = null
  } = options;

  const events = new Map();          // 事件 -> 订阅者数组
  const sticky = new Map();          // 事件 -> 历史参数队列
  const wildcardRegexCache = new Map(); // 通配符模式 -> 正则表达式
  let idCounter = 0;

  /**
   * 将通配符模式转换为正则表达式，支持 `*` 匹配单级（不含 `:`），`**` 匹配多级。
   * @param {string} pattern - 通配符模式，如 `"user:*"`, `"a:b:**"`。
   * @returns {RegExp} 编译后的正则表达式。
   * @private
   */
  function wildcardToRegex(pattern) {
    if (wildcardRegexCache.has(pattern)) return wildcardRegexCache.get(pattern);
    let escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&');
    escaped = escaped.replace(/\*\*/g, '<<DOUBLE_STAR>>');
    escaped = escaped.replace(/\*/g, '[^:]+');
    escaped = escaped.replace(/<<DOUBLE_STAR>>/g, '.*');
    const regex = new RegExp(`^${escaped}$`);
    wildcardRegexCache.set(pattern, regex);
    return regex;
  }

  /**
   * 判断字符串是否包含通配符 `*`。
   * @param {string} str
   * @returns {boolean}
   * @private
   */
  function isWildcard(str) { return str.includes('*'); }

  /**
   * 获取所有匹配事件名称的订阅者，包含精确匹配和通配符匹配，按优先级排序。
   * 排序规则：priority 小的优先；相同 priority 下精确匹配优先于通配符；同类型按注册顺序。
   * @param {string} eventName - 事件名称。
   * @returns {Array<Object>} 订阅者数组。
   * @private
   */
  function getMatchingSubscribers(eventName) {
    const matched = [];
    if (events.has(eventName)) matched.push(...events.get(eventName));
    for (const [pattern, subs] of events.entries()) {
      if (!isWildcard(pattern)) continue;
      if (wildcardToRegex(pattern).test(eventName)) matched.push(...subs);
    }
    matched.sort((a, b) => {
      if (a.priority !== b.priority) return a.priority - b.priority;
      const aExact = !isWildcard(a.originalEvent), bExact = !isWildcard(b.originalEvent);
      if (aExact !== bExact) return aExact ? -1 : 1;
      return a.id - b.id;
    });
    return matched;
  }

  /**
   * 内部日志记录，如果配置了 `onLog` 则调用。
   * @param {string} level - 日志级别
   * @param {string} message - 日志消息
   * @param {Object} data - 附加数据
   * @private
   */
  function log(level, message, data) {
    if (onLog) try { onLog(level, message, data); } catch {}
  }

  /**
   * 错误处理，如果配置了 `onError` 则调用。
   * @param {Error} error - 错误对象
   * @param {string} eventName - 事件名称
   * @param {Object} subscriber - 出错的订阅者
   * @private
   */
  function handleError(error, eventName, subscriber) {
    if (onError) try { onError(error, eventName, subscriber); } catch {}
  }

  /**
   * 触发一组订阅者，支持同步/异步。
   * @param {Array} subscribers - 订阅者数组
   * @param {Array} args - 传递给回调的参数
   * @param {string} eventName - 事件名称（用于通配符订阅者时作为第一个参数）
   * @param {boolean} waitAsync - 是否等待异步回调（Promise）全部完成
   * @returns {Promise|undefined} 如果 `waitAsync` 为 true 且存在 Promise，返回一个等待所有 Promise settled 的 Promise。
   * @private
   */
  function triggerSubscribers(subscribers, args, eventName, waitAsync) {
    const promises = [];
    for (const sub of subscribers) {
      try {
        const callArgs = isWildcard(sub.originalEvent) ? [eventName, ...args] : args;
        const result = sub.callback.apply(sub.context, callArgs);
        if (waitAsync && result instanceof Promise) promises.push(result);
      } catch (error) {
        handleError(error, eventName, sub);
      }
    }
    if (waitAsync && promises.length > 0) return Promise.allSettled(promises).then(() => {});
  }

  /**
   * 订阅事件。
   *
   * @param {string} event - 事件名称，支持通配符 `*` (单级) 和 `**` (多级)。
   * @param {Function} callback - 回调函数，精确匹配时参数为 `emit` 传入的实参；通配符订阅时第一个参数为事件名称，之后为实参。
   * @param {Object} [opts] - 订阅选项
   * @param {number} [opts.priority=0] - 优先级，数字越小越先执行。
   * @param {Object} [opts.context] - 回调函数执行时的 `this` 上下文。
   * @param {boolean} [opts.replayAll=false] - 粘性事件回放：true 回放所有历史事件，false 只回放最后一条（默认）。
   * @returns {Function} 取消订阅函数，调用后移除该订阅。
   *
   * @example
   * // 订阅 user 命名空间下所有事件
   * const off = bus.on('user:*', (event, data) => console.log(event, data));
   * // 稍后取消
   * off();
   */
  function on(event, callback, opts = {}) {
    const { priority = 0, context = null, replayAll = false } = opts;
    const id = ++idCounter;
    const subscriber = { id, callback, priority, once: false, context, originalEvent: event };
    if (!events.has(event)) events.set(event, []);
    events.get(event).push(subscriber);
    log('debug', `订阅事件: ${event}`, { subscriberId: id });

    // 粘性事件回放
    if (historySize > 0 && sticky.has(event)) {
      const records = sticky.get(event);
      if (records.length > 0) {
        const toReplay = replayAll ? records : [records[records.length - 1]];
        toReplay.forEach(record => {
          try { callback.apply(context, record.args); } catch (error) { handleError(error, event, subscriber); }
        });
      }
    }
    return () => off(event, callback);
  }

  /**
   * 单次订阅事件，触发后自动取消订阅。
   *
   * @param {string} event - 事件名称，支持通配符。
   * @param {Function} callback - 回调函数。
   * @param {Object} [opts] - 可选配置，同 `on` 方法。
   * @returns {Function} 取消订阅函数，可用于提前取消。
   */
  function once(event, callback, opts = {}) {
    const { priority = 0, context = null, replayAll = false } = opts;
    const id = ++idCounter;
    const subscriber = { id, callback, priority, once: true, context, originalEvent: event };
    if (!events.has(event)) events.set(event, []);
    events.get(event).push(subscriber);
    log('debug', `单次订阅事件: ${event}`, { subscriberId: id });

    if (historySize > 0 && sticky.has(event)) {
      const records = sticky.get(event);
      if (records.length > 0) {
        const toReplay = replayAll ? records : [records[records.length - 1]];
        toReplay.forEach(record => {
          try { callback.apply(context, record.args); } catch (error) { handleError(error, event, subscriber); }
        });
        off(event, callback);
      }
    }
    return () => off(event, callback);
  }

  /**
   * 发布事件（同步），按优先级和通配符匹配顺序同步通知所有订阅者。
   *
   * @param {string} event - 事件名称。
   * @param {...*} args - 传递给订阅者的参数。
   *
   * @example
   * bus.emit('page:load', { url: '/home' });
   * bus.emit('user:*', 'login'); // 不会触发通配符，因为事件名即为 'user:*' 字符串
   */
  function emit(event, ...args) {
    if (historySize > 0) {
      if (!sticky.has(event)) sticky.set(event, []);
      const records = sticky.get(event);
      records.push({ args, timestamp: Date.now() });
      if (records.length > historySize) records.shift();
    }
    log('debug', `发布事件: ${event}`, { argsCount: args.length });
    const subscribers = getMatchingSubscribers(event);
    const onceSubscribers = subscribers.filter(s => s.once);
    triggerSubscribers(subscribers, args, event, false);
    onceSubscribers.forEach(s => off(s.originalEvent, s.callback));
  }

  /**
   * 发布事件（异步），等待所有订阅者返回的 Promise 全部 settled。
   * 用法同 `emit`，但返回 Promise。
   *
   * @param {string} event - 事件名称。
   * @param {...*} args - 参数。
   * @returns {Promise<void>} 在所有异步订阅者完成后 resolve。
   */
  async function emitAsync(event, ...args) {
    if (historySize > 0) {
      if (!sticky.has(event)) sticky.set(event, []);
      const records = sticky.get(event);
      records.push({ args, timestamp: Date.now() });
      if (records.length > historySize) records.shift();
    }
    log('debug', `异步发布事件: ${event}`, { argsCount: args.length });
    const subscribers = getMatchingSubscribers(event);
    const onceSubscribers = subscribers.filter(s => s.once);
    await triggerSubscribers(subscribers, args, event, true);
    onceSubscribers.forEach(s => off(s.originalEvent, s.callback));
  }

  /**
   * 取消订阅。如果只提供事件名，则移除该事件的所有订阅者。
   * 如果同时提供回调，则只移除该特定回调的订阅。
   * 对于通配符模式，也会尝试从匹配的模式中移除。
   *
   * @param {string} event - 事件名称或模式。
   * @param {Function} [callback] - 要移除的特定回调函数。
   */
  function off(event, callback) {
    if (!callback) {
      if (events.has(event)) {
        const count = events.get(event).length;
        events.delete(event);
        log('debug', `移除事件所有订阅: ${event}`, { removedCount: count });
      }
      return;
    }
    if (events.has(event)) {
      const subs = events.get(event);
      const index = subs.findIndex(s => s.callback === callback);
      if (index !== -1) {
        subs.splice(index, 1);
        log('debug', `移除订阅回调: ${event}`);
        if (subs.length === 0) events.delete(event);
      }
      return;
    }
    // 如果是精确事件名但不在精确订阅中，尝试在通配符模式中查找
    if (!isWildcard(event)) {
      for (const [pattern, subs] of events.entries()) {
        if (!isWildcard(pattern)) continue;
        if (wildcardToRegex(pattern).test(event)) {
          const index = subs.findIndex(s => s.callback === callback);
          if (index !== -1) {
            subs.splice(index, 1);
            log('debug', `从通配符 ${pattern} 中移除回调: ${event}`);
            if (subs.length === 0) events.delete(pattern);
            return;
          }
        }
      }
    }
  }

  /**
   * 清除所有事件订阅、粘性历史、通配符缓存。重置事件总线。
   */
  function clear() {
    events.clear(); sticky.clear(); wildcardRegexCache.clear();
    log('debug', '事件总线已清除');
  }

  /**
   * 获取当前所有已注册的事件名称（包括通配符模式）。
   * @returns {string[]} 事件名称数组。
   */
  function getEventNames() { return Array.from(events.keys()); }

  /**
   * 获取某个事件的所有订阅者（快照）。
   * @param {string} event - 事件名称。
   * @returns {Array} 订阅者数组。
   */
  function getSubscribers(event) { return events.has(event) ? events.get(event).slice() : []; }

  return { on, once, emit, emitAsync, off, clear, getEventNames, getSubscribers };
}

export { createEventBus };