/**
 * @module plugins/pluginTooltip
 * @description 悬停提示
 *
 * 特性：
 *   - 通过 CSS 选择器绑定 tooltip
 *   - 支持 HTML 内容、延迟显示、自定义位置
 *   - 自动跟随主题
 *
 * 使用：
 *   uiApi.tooltip.attach('.my-button', '点击这里保存');
 *   uiApi.tooltip.attach('.avatar', (el) => `<strong>${el.alt}</strong>`);
 */

/**
 * 为某插件创建 tooltip 对象
 * @param {string} pluginId
 * @returns {Object}
 */
export function createPluginTooltip(pluginId) {
  // 注册表：Map<selector, Array<{ content, opts, handler }>>
  const registrations = new Map();

  // 当前显示的 tooltip
  let activeTooltip = null;
  let showTimer = null;
  let hideTimer = null;
  let currentTarget = null;

  let listenersAttached = false;

  // ============================================================
  // 创建 tooltip 元素
  // ============================================================

  function buildTooltip(content, opts = {}) {
    const tooltip = document.createElement('div');
    tooltip.className = 'plugin-tooltip';

    // 内容：字符串或 HTML
    if (typeof content === 'string') {
      if (opts.html) {
        tooltip.innerHTML = content;
      } else {
        tooltip.textContent = content;
      }
    } else if (content instanceof Node) {
      tooltip.appendChild(content);
    } else {
      tooltip.textContent = String(content);
    }

    // 默认样式
    const maxWidth = opts.maxWidth || '260px';
    const theme = opts.theme || 'dark';

    let bg, color, border;
    if (theme === 'dark') {
      bg = 'rgba(20, 20, 35, 0.95)';
      color = '#f0f0f8';
      border = 'rgba(255, 255, 255, 0.08)';
    } else {
      bg = 'var(--color-bg-primary)';
      color = 'var(--color-text-primary)';
      border = 'var(--color-border)';
    }

    tooltip.style.cssText = `
      position: fixed;
      z-index: 9999;
      max-width: ${maxWidth};
      background: ${bg};
      color: ${color};
      border: 1px solid ${border};
      border-radius: 6px;
      padding: 6px 10px;
      font-size: 0.8rem;
      line-height: 1.5;
      box-shadow: 0 4px 20px rgba(0, 0, 0, 0.2);
      pointer-events: none;
      opacity: 0;
      transition: opacity 0.15s ease;
      word-break: break-word;
    `;

    return tooltip;
  }

  // ============================================================
  // 定位
  // ============================================================

  function positionTooltip(tooltip, target, placement = 'top') {
    const targetRect = target.getBoundingClientRect();
    const tooltipRect = tooltip.getBoundingClientRect();

    let x = 0;
    let y = 0;

    switch (placement) {
      case 'top':
        x = targetRect.left + targetRect.width / 2 - tooltipRect.width / 2;
        y = targetRect.top - tooltipRect.height - 8;
        break;
      case 'bottom':
        x = targetRect.left + targetRect.width / 2 - tooltipRect.width / 2;
        y = targetRect.bottom + 8;
        break;
      case 'left':
        x = targetRect.left - tooltipRect.width - 8;
        y = targetRect.top + targetRect.height / 2 - tooltipRect.height / 2;
        break;
      case 'right':
        x = targetRect.right + 8;
        y = targetRect.top + targetRect.height / 2 - tooltipRect.height / 2;
        break;
      default:
        x = targetRect.left + targetRect.width / 2 - tooltipRect.width / 2;
        y = targetRect.top - tooltipRect.height - 8;
    }

    // 边界修正
    const padding = 8;
    if (x < padding) x = padding;
    if (x + tooltipRect.width > window.innerWidth - padding) {
      x = window.innerWidth - tooltipRect.width - padding;
    }
    if (y < padding) {
      // 顶部放不下，翻到底部
      y = targetRect.bottom + 8;
    }
    if (y + tooltipRect.height > window.innerHeight - padding) {
      y = targetRect.top - tooltipRect.height - 8;
    }

    tooltip.style.left = x + 'px';
    tooltip.style.top = y + 'px';
  }

  // ============================================================
  // 显示 / 隐藏
  // ============================================================

  function showTooltip(target, content, opts) {
    closeActiveTooltip();

    const tooltip = buildTooltip(content, opts);
    document.body.appendChild(tooltip);
    activeTooltip = tooltip;
    currentTarget = target;

    // 先渲染一次以计算尺寸
    positionTooltip(tooltip, target, opts.placement);

    // 淡入
    requestAnimationFrame(() => {
      tooltip.style.opacity = '1';
    });
  }

  function closeActiveTooltip() {
    if (showTimer) {
      clearTimeout(showTimer);
      showTimer = null;
    }
    if (hideTimer) {
      clearTimeout(hideTimer);
      hideTimer = null;
    }
    if (activeTooltip) {
      activeTooltip.remove();
      activeTooltip = null;
    }
    currentTarget = null;
  }

  // ============================================================
  // 事件处理
  // ============================================================

  function handleMouseOver(e) {
    const target = findTarget(e.target);
    if (!target) return;
    if (target === currentTarget && activeTooltip) return;

    const entry = findEntry(target);
    if (!entry) return;

    const { content, opts } = resolveContent(entry, target);
    if (content === null || content === undefined || content === '') return;

    const delay = opts.delay || 300;

    if (delay > 0) {
      showTimer = setTimeout(() => {
        showTooltip(target, content, opts);
      }, delay);
    } else {
      showTooltip(target, content, opts);
    }
  }

  function handleMouseOut(e) {
    const target = findTarget(e.target);
    if (!target) return;

    // 如果鼠标仍在 tooltip 的绑定元素内，不关闭
    const relatedTarget = e.relatedTarget;
    if (relatedTarget && target.contains(relatedTarget)) return;

    closeActiveTooltip();
  }

  function findTarget(el) {
    if (!el || el.nodeType !== 1) return null;
    for (const selector of registrations.keys()) {
      const target = el.closest(selector);
      if (target) return target;
    }
    return null;
  }

  function findEntry(target) {
    for (const [selector, entries] of registrations.entries()) {
      if (target.matches(selector) || target.closest(selector) === target) {
        // 找到第一个匹配的条目
        return entries[0];
      }
    }
    // 兜底：遍历所有
    for (const entries of registrations.values()) {
      if (entries.length > 0) return entries[0];
    }
    return null;
  }

  function resolveContent(entry, target) {
    const { content, opts } = entry;
    if (typeof content === 'function') {
      try {
        const resolved = content(target);
        return { content: resolved, opts: opts || {} };
      } catch (err) {
        console.error(`[PluginTooltip:${pluginId}] 内容生成失败:`, err);
        return { content: null, opts: {} };
      }
    }
    return { content, opts: opts || {} };
  }

  function attachListeners() {
    if (listenersAttached) return;
    document.addEventListener('mouseover', handleMouseOver);
    document.addEventListener('mouseout', handleMouseOut);
    window.addEventListener('scroll', closeActiveTooltip, true);
    listenersAttached = true;
  }

  function detachListeners() {
    if (!listenersAttached) return;
    document.removeEventListener('mouseover', handleMouseOver);
    document.removeEventListener('mouseout', handleMouseOut);
    window.removeEventListener('scroll', closeActiveTooltip, true);
    listenersAttached = false;
    closeActiveTooltip();
  }

  // ============================================================
  // 公开 API
  // ============================================================

  return {
    /**
     * 绑定 tooltip
     * @param {string} selector - CSS 选择器
     * @param {string|Function} content - 文本、HTML 或函数 (target) => content
     * @param {Object} [opts]
     * @param {string} [opts.placement='top'] - 'top' | 'bottom' | 'left' | 'right'
     * @param {number} [opts.delay=300] - 显示延迟（毫秒）
     * @param {boolean} [opts.html=false] - 内容是否为 HTML
     * @param {string} [opts.maxWidth='260px']
     * @param {string} [opts.theme='dark'] - 'dark' | 'light'
     * @returns {Function} 取消绑定
     */
    attach(selector, content, opts = {}) {
      if (!selector || typeof selector !== 'string') {
        throw new Error('tooltip.attach: selector 必须是非空字符串');
      }
      if (typeof content !== 'string' && typeof content !== 'function' && !(content instanceof Node)) {
        throw new Error('tooltip.attach: content 必须是字符串、函数或 DOM 节点');
      }

      if (!registrations.has(selector)) {
        registrations.set(selector, []);
      }
      const entries = registrations.get(selector);
      const entry = { pluginId, content, opts };
      entries.push(entry);

      attachListeners();

      return () => {
        const list = registrations.get(selector);
        if (list) {
          const idx = list.indexOf(entry);
          if (idx !== -1) list.splice(idx, 1);
          if (list.length === 0) registrations.delete(selector);
        }
        if (registrations.size === 0) detachListeners();
      };
    },

    /**
     * 手动显示 tooltip
     */
    show(target, content, opts = {}) {
      showTooltip(target, content, opts);
    },

    /**
     * 隐藏当前 tooltip
     */
    hide() {
      closeActiveTooltip();
    },

    /**
     * 列出已绑定的选择器
     */
    list() {
      return Array.from(registrations.keys());
    },
  };
}