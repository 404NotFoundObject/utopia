/**
 * @module plugins/pluginLoading
 * @description 全局加载遮罩
 *
 * 特性：
 *   - 支持多插件并发显示（计数器）
 *   - 显示自定义消息
 *   - 全局自动清理
 *
 * 使用：
 *   uiApi.loading.show('加载中...');
 *   await doSomething();
 *   uiApi.loading.hide();
 *
 *   // 或使用封装
 *   const result = await uiApi.loading.wrap(async () => {
 *     return await fetchData();
 *   }, '加载数据中...');
 */

/**
 * 为某插件创建 loading 对象
 * @param {string} pluginId
 * @returns {Object}
 */
export function createPluginLoading(pluginId) {
  // 全局遮罩元素（单例）
  let overlay = null;
  // 每个插件的计数
  const counts = new Map();
  // 每个插件当前的消息
  const messages = new Map();

  // ============================================================
  // 创建遮罩
  // ============================================================

  function ensureOverlay() {
    if (overlay && overlay.isConnected) return overlay;

    overlay = document.createElement('div');
    overlay.className = 'plugin-loading-overlay';
    overlay.style.cssText = `
      position: fixed;
      inset: 0;
      background: rgba(0, 0, 0, 0.4);
      backdrop-filter: blur(2px);
      -webkit-backdrop-filter: blur(2px);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 99999;
      opacity: 0;
      transition: opacity 0.2s ease;
      pointer-events: auto;
    `;

    const spinner = document.createElement('div');
    spinner.style.cssText = `
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 0.8rem;
      padding: 1.5rem 2rem;
      background: var(--color-bg-primary);
      border-radius: var(--radius-lg);
      box-shadow: var(--shadow-xl);
      border: 1px solid var(--color-border);
      min-width: 160px;
      max-width: 80vw;
    `;

    const icon = document.createElement('div');
    icon.innerHTML = '<i class="fas fa-spinner fa-spin" style="font-size: 2rem; color: var(--color-primary);"></i>';
    spinner.appendChild(icon);

    const text = document.createElement('div');
    text.className = 'plugin-loading-text';
    text.style.cssText = `
      font-size: 0.9rem;
      color: var(--color-text-secondary);
      text-align: center;
      max-width: 240px;
      word-break: break-word;
    `;
    text.textContent = '加载中...';
    spinner.appendChild(text);

    overlay.appendChild(spinner);
    document.body.appendChild(overlay);

    // 淡入
    requestAnimationFrame(() => {
      overlay.style.opacity = '1';
    });

    return overlay;
  }

  function updateText() {
    if (!overlay) return;
    // 优先显示最先 show 的插件的消息
    const textEl = overlay.querySelector('.plugin-loading-text');
    if (!textEl) return;

    // 收集所有非空消息
    const allMessages = [];
    for (const [pid, count] of counts.entries()) {
      if (count > 0) {
        const msg = messages.get(pid);
        if (msg) allMessages.push(msg);
      }
    }

    if (allMessages.length === 0) {
      textEl.textContent = '加载中...';
    } else if (allMessages.length === 1) {
      textEl.textContent = allMessages[0];
    } else {
      textEl.textContent = allMessages[0] + ' （+' + (allMessages.length - 1) + '）';
    }
  }

  function removeOverlay() {
    if (!overlay) return;
    const el = overlay;
    overlay = null;
    el.style.opacity = '0';
    setTimeout(() => {
      if (el.parentNode) el.parentNode.removeChild(el);
    }, 200);
  }

  // ============================================================
  // 公开 API
  // ============================================================

  return {
    /**
     * 显示加载遮罩
     * @param {string} [message]
     */
    show(message = '加载中...') {
      const count = (counts.get(pluginId) || 0) + 1;
      counts.set(pluginId, count);
      messages.set(pluginId, message);

      if (count === 1) {
        ensureOverlay();
      }
      updateText();
    },

    /**
     * 隐藏加载遮罩
     */
    hide() {
      const count = (counts.get(pluginId) || 0) - 1;
      if (count <= 0) {
        counts.delete(pluginId);
        messages.delete(pluginId);
      } else {
        counts.set(pluginId, count);
      }

      // 检查是否还有其他插件在 loading
      let hasAny = false;
      for (const c of counts.values()) {
        if (c > 0) { hasAny = true; break; }
      }

      if (!hasAny) {
        removeOverlay();
      } else {
        updateText();
      }
    },

    /**
     * 更新当前显示的消息
     */
    setMessage(message) {
      if (!counts.has(pluginId)) return;
      messages.set(pluginId, message);
      updateText();
    },

    /**
     * 强制清空该插件的所有 loading
     */
    reset() {
      counts.delete(pluginId);
      messages.delete(pluginId);

      let hasAny = false;
      for (const c of counts.values()) {
        if (c > 0) { hasAny = true; break; }
      }
      if (!hasAny) removeOverlay();
      else updateText();
    },

    /**
     * 包装异步函数，自动 show/hide
     * @param {Function} fn
     * @param {string} [message]
     * @returns {Promise<*>}
     */
    async wrap(fn, message = '处理中...') {
      this.show(message);
      try {
        return await fn();
      } finally {
        this.hide();
      }
    },

    /**
     * 是否正在显示
     */
    isActive() {
      return (counts.get(pluginId) || 0) > 0;
    },
  };
}