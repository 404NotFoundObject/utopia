/**
 * @module plugins/pluginHotkey
 * @description 快捷键注册
 *
 * 特性：
 *   - 支持组合键：Ctrl+K、Ctrl+Shift+K、Alt+1 等
 *   - 自动跳过输入框、textarea、contenteditable 场景
 *   - 插件卸载时自动清理
 *
 * 快捷键格式：
 *   "Ctrl+K"、"Alt+Shift+1"、"Ctrl+Shift+K"、"F5"、"Escape"
 */

/**
 * 为某插件创建 hotkey 对象
 * @param {string} pluginId
 * @returns {Object}
 */
export function createPluginHotkey(pluginId) {
  // 该插件注册的所有快捷键：Map<hotkeyString, Set<handler>>
  const registrations = new Map();

  // 单个全局事件监听（懒加载）
  let listenerAttached = false;

  /**
   * 解析快捷键字符串
   * @param {string} str - 如 "Ctrl+Shift+K"
   * @returns {{ ctrl, shift, alt, meta, key }}
   */
  function parseHotkey(str) {
    const parts = String(str).split('+').map(s => s.trim()).filter(Boolean);
    const result = { ctrl: false, shift: false, alt: false, meta: false, key: '' };

    for (const part of parts) {
      const lower = part.toLowerCase();
      if (lower === 'ctrl' || lower === 'control') result.ctrl = true;
      else if (lower === 'shift') result.shift = true;
      else if (lower === 'alt' || lower === 'option') result.alt = true;
      else if (lower === 'meta' || lower === 'cmd' || lower === 'command' || lower === 'win') result.meta = true;
      else result.key = part; // 保留原始大小写，在匹配时统一处理
    }

    return result;
  }

  /**
   * 判断事件是否匹配快捷键
   */
  function matches(event, parsed) {
    if (event.ctrlKey !== parsed.ctrl) return false;
    if (event.shiftKey !== parsed.shift) return false;
    if (event.altKey !== parsed.alt) return false;
    if (event.metaKey !== parsed.meta) return false;

    const eventKey = event.key;
    const targetKey = parsed.key;

    // 大小写不敏感的单字符比较
    if (eventKey.length === 1 && targetKey.length === 1) {
      return eventKey.toLowerCase() === targetKey.toLowerCase();
    }
    // 功能键 / 特殊键
    return eventKey === targetKey;
  }

  /**
   * 判断当前焦点是否在可输入元素上
   */
  function isInputFocused() {
    const active = document.activeElement;
    if (!active) return false;
    const tag = active.tagName.toLowerCase();
    if (tag === 'input' || tag === 'textarea' || tag === 'select') return true;
    if (active.isContentEditable) return true;
    return false;
  }

  /**
   * 全局键盘监听
   */
  function handleKeydown(event) {
    // 输入框里通常不触发快捷键（除非带 Ctrl/Alt/Meta）
    const inputFocused = isInputFocused();
    const hasModifier = event.ctrlKey || event.altKey || event.metaKey;

    // 先收集所有匹配的 handler
    const matched = [];
    for (const [hotkeyStr, handlers] of registrations.entries()) {
      const parsed = parseHotkey(hotkeyStr);
      if (matches(event, parsed)) {
        // 输入框场景：只允许带修饰键的快捷键
        if (inputFocused && !hasModifier) continue;
        for (const h of handlers) {
          matched.push({ hotkeyStr, handler: h });
        }
      }
    }

    if (matched.length === 0) return;

    // 按注册顺序执行，阻止默认行为
    let preventDefault = false;
    for (const { hotkeyStr, handler } of matched) {
      try {
        const result = handler(event);
        if (result === true) preventDefault = true;
      } catch (err) {
        console.error(`[PluginHotkey:${pluginId}] 快捷键 ${hotkeyStr} 执行失败:`, err);
      }
    }

    if (preventDefault) {
      event.preventDefault();
      event.stopPropagation();
    }
  }

  function attachListener() {
    if (listenerAttached) return;
    document.addEventListener('keydown', handleKeydown);
    listenerAttached = true;
  }

  function detachListener() {
    if (!listenerAttached) return;
    document.removeEventListener('keydown', handleKeydown);
    listenerAttached = false;
  }

  return {
    /**
     * 注册快捷键
     * @param {string} hotkey - 快捷键字符串
     * @param {Function} handler - (event) => boolean | void
     *                            返回 true 表示阻止默认行为
     * @returns {Function} 取消注册
     *
     * @example
     * const off = uiApi.hotkey.register('Ctrl+K', (e) => {
     *   console.log('按下了 Ctrl+K');
     *   return true;  // 阻止浏览器默认行为
     * });
     *
     * // 后续取消
     * off();
     */
    register(hotkey, handler) {
      if (typeof handler !== 'function') {
        throw new TypeError('hotkey.register: handler 必须是函数');
      }
      if (!hotkey || typeof hotkey !== 'string') {
        throw new Error('hotkey.register: hotkey 必须是非空字符串');
      }

      const normalizedKey = normalizeHotkeyString(hotkey);

      if (!registrations.has(normalizedKey)) {
        registrations.set(normalizedKey, new Set());
      }
      registrations.get(normalizedKey).add(handler);

      attachListener();

      // 返回取消函数
      return () => {
        const set = registrations.get(normalizedKey);
        if (set) {
          set.delete(handler);
          if (set.size === 0) {
            registrations.delete(normalizedKey);
          }
        }
        if (registrations.size === 0) {
          detachListener();
        }
      };
    },

    /**
     * 取消某快捷键的所有 handler
     */
    unregister(hotkey) {
      const normalizedKey = normalizeHotkeyString(hotkey);
      registrations.delete(normalizedKey);
      if (registrations.size === 0) {
        detachListener();
      }
    },

    /**
     * 取消该插件的所有快捷键
     */
    unregisterAll() {
      registrations.clear();
      detachListener();
    },

    /**
     * 列出已注册的快捷键
     */
    list() {
      return Array.from(registrations.keys());
    },
  };
}

/**
 * 规范化快捷键字符串（统一修饰键名，便于匹配）
 */
function normalizeHotkeyString(str) {
  return String(str).split('+').map(s => s.trim()).map(s => {
    const lower = s.toLowerCase();
    if (lower === 'ctrl' || lower === 'control') return 'Ctrl';
    if (lower === 'shift') return 'Shift';
    if (lower === 'alt' || lower === 'option') return 'Alt';
    if (lower === 'meta' || lower === 'cmd' || lower === 'command' || lower === 'win') return 'Meta';
    return s;
  }).join('+');
}