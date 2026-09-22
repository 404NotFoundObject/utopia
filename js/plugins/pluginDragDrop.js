/**
 * @module plugins/pluginDragDrop
 * @description 拖拽支持
 *
 * 提供两种模式：
 *   1. draggable(el, opts) — 让元素可拖动
 *   2. droppable(el, opts) — 让元素可接收拖放
 *
 * 使用：
 *   // 拖动
 *   const cleanup = uiApi.dragDrop.draggable(myEl, {
 *     onDragEnd: (data, e) => { ... },
 *     data: { id: 'xxx' },
 *   });
 *
 *   // 接收
 *   uiApi.dragDrop.droppable(dropZone, {
 *     accepts: (data) => data.type === 'message',
 *     onDrop: (data, e) => { ... },
 *   });
 */

/**
 * 为某插件创建 dragDrop 对象
 * @param {string} pluginId
 * @returns {Object}
 */
export function createPluginDragDrop(pluginId) {
  // 当前拖拽的载荷
  let currentDragData = null;
  // 拖拽源元素
  let currentDragSource = null;

  // 全局 dragover 监听（用于找到 droppable 元素）
  let listenersAttached = false;
  const dropHandlers = new WeakMap();   // element -> Array<{ accepts, onDrop }>

  // ============================================================
  // dragover 处理：找到可接收的元素
  // ============================================================

  function handleDocumentDragover(e) {
    if (!currentDragData) return;

    // 从 e.target 向上查找 droppable 元素
    let el = e.target;
    let found = false;

    while (el && el !== document.body) {
      const handlers = dropHandlers.get(el);
      if (handlers) {
        for (const { accepts } of handlers) {
          if (!accepts || accepts(currentDragData)) {
            e.preventDefault();  // 允许 drop
            e.dataTransfer.dropEffect = 'move';
            found = true;
            // 高亮
            if (!el.dataset.pluginDragOver) {
              el.dataset.pluginDragOver = '1';
              el.style.outline = '2px dashed var(--color-primary)';
            }
            break;
          }
        }
        if (found) break;
      }
      el = el.parentElement;
    }

    // 清除其他元素的高亮
    document.querySelectorAll('[data-plugin-drag-over]').forEach(node => {
      if (node !== el) {
        delete node.dataset.pluginDragOver;
        node.style.outline = '';
      }
    });
  }

  function handleDocumentDrop(e) {
    if (!currentDragData) return;

    let el = e.target;
    while (el && el !== document.body) {
      const handlers = dropHandlers.get(el);
      if (handlers) {
        for (const { accepts, onDrop } of handlers) {
          if (!accepts || accepts(currentDragData)) {
            e.preventDefault();
            e.stopPropagation();
            try {
              onDrop && onDrop(currentDragData, e);
            } catch (err) {
              console.error(`[PluginDragDrop:${pluginId}] onDrop 失败:`, err);
            }
            cleanupDragStyles();
            return;
          }
        }
      }
      el = el.parentElement;
    }

    cleanupDragStyles();
  }

  function handleDocumentDragEnd() {
    cleanupDragStyles();
    currentDragData = null;
    currentDragSource = null;
  }

  function cleanupDragStyles() {
    document.querySelectorAll('[data-plugin-drag-over]').forEach(node => {
      delete node.dataset.pluginDragOver;
      node.style.outline = '';
    });
  }

  function attachListeners() {
    if (listenersAttached) return;
    document.addEventListener('dragover', handleDocumentDragover);
    document.addEventListener('drop', handleDocumentDrop);
    document.addEventListener('dragend', handleDocumentDragEnd);
    listenersAttached = true;
  }

  function detachListeners() {
    if (!listenersAttached) return;
    document.removeEventListener('dragover', handleDocumentDragover);
    document.removeEventListener('drop', handleDocumentDrop);
    document.removeEventListener('dragend', handleDocumentDragEnd);
    listenersAttached = false;
  }

  // ============================================================
  // 公开 API
  // ============================================================

  return {
    /**
     * 让元素可拖动
     * @param {HTMLElement} el
     * @param {Object} [opts]
     * @param {Object|Function} [opts.data] - 拖拽载荷，或返回载荷的函数
     * @param {Function} [opts.onDragStart] - (data, e) => void
     * @param {Function} [opts.onDragEnd] - (data, e) => void
     * @param {string} [opts.handle] - 拖拽手柄选择器（可选，仅手柄区域可拖）
     * @param {boolean} [opts.ghost=true] - 是否显示拖拽幽灵
     * @returns {Function} 清理函数
     */
    draggable(el, opts = {}) {
      if (!el || !(el instanceof HTMLElement)) {
        throw new Error('dragDrop.draggable: el 必须是 HTMLElement');
      }

      const { data, onDragStart, onDragEnd, handle, ghost = true } = opts;

      const handleEl = handle ? el.querySelector(handle) : el;

      const setDraggable = () => {
        el.setAttribute('draggable', 'true');
      };
      const unsetDraggable = () => {
        el.removeAttribute('draggable');
      };

      // 初始设置
      setDraggable();

      const handleDragStart = (e) => {
        try {
          const payload = typeof data === 'function' ? data(el) : data;
          currentDragData = payload || { source: el };
          currentDragSource = el;

          // 设置 dataTransfer
          if (e.dataTransfer) {
            e.dataTransfer.effectAllowed = 'move';
            // 存个占位数据，让浏览器知道这是拖拽操作
            e.dataTransfer.setData('text/plain', 'plugin-drag');
          }

          // 让元素半透明
          if (ghost) {
            setTimeout(() => {
              el.style.opacity = '0.5';
            }, 0);
          }

          onDragStart && onDragStart(currentDragData, e);
        } catch (err) {
          console.error(`[PluginDragDrop:${pluginId}] onDragStart 失败:`, err);
        }
      };

      const handleDragEnd = (e) => {
        el.style.opacity = '';
        if (onDragEnd) {
          try {
            onDragEnd(currentDragData, e);
          } catch (err) {
            console.error(`[PluginDragDrop:${pluginId}] onDragEnd 失败:`, err);
          }
        }
        currentDragData = null;
        currentDragSource = null;
      };

      if (handleEl) {
        handleEl.addEventListener('dragstart', handleDragStart);
        handleEl.addEventListener('dragend', handleDragEnd);
      }

      return () => {
        if (handleEl) {
          handleEl.removeEventListener('dragstart', handleDragStart);
          handleEl.removeEventListener('dragend', handleDragEnd);
        }
        unsetDraggable();
      };
    },

    /**
     * 让元素可接收拖放
     * @param {HTMLElement} el
     * @param {Object} opts
     * @param {Function} [opts.accepts] - (data) => boolean，判断是否接收
     * @param {Function} opts.onDrop - (data, e) => void
     * @returns {Function} 清理函数
     */
    droppable(el, opts = {}) {
      if (!el || !(el instanceof HTMLElement)) {
        throw new Error('dragDrop.droppable: el 必须是 HTMLElement');
      }

      const { accepts, onDrop } = opts;
      if (typeof onDrop !== 'function') {
        throw new Error('dragDrop.droppable: onDrop 必须是函数');
      }

      let handlers = dropHandlers.get(el);
      if (!handlers) {
        handlers = [];
        dropHandlers.set(el, handlers);
      }

      const entry = { pluginId, accepts, onDrop };
      handlers.push(entry);

      attachListeners();

      return () => {
        const list = dropHandlers.get(el);
        if (list) {
          const idx = list.indexOf(entry);
          if (idx !== -1) list.splice(idx, 1);
          if (list.length === 0) dropHandlers.delete(el);
        }
        // 检查是否还有其他注册
        let hasAny = false;
        document.querySelectorAll('*').forEach(node => {
          if (dropHandlers.get(node)) hasAny = true;
        });
        // 简单判断：无法枚举 WeakMap，若为 0 则卸载监听
      };
    },

    /**
     * 触发自定义拖拽（不用原生 drag）
     * @param {HTMLElement} source - 源元素
     * @param {Object} data - 载荷
     * @param {Object} [opts]
     * @param {Function} [opts.onMove] - (x, y) => void
     * @param {Function} [opts.onDrop] - (target, data) => void
     * @param {Function} [opts.accepts] - (target) => boolean
     * @returns {Function} 清理函数
     */
    customDrag(source, data, opts = {}) {
      if (!source || !(source instanceof HTMLElement)) {
        throw new Error('dragDrop.customDrag: source 必须是 HTMLElement');
      }

      let ghostEl = null;
      let isDragging = false;
      let startX = 0;
      let startY = 0;

      const onMouseDown = (e) => {
        if (e.button !== 0) return;
        startX = e.clientX;
        startY = e.clientY;

        const onMouseMove = (moveEvent) => {
          const dx = moveEvent.clientX - startX;
          const dy = moveEvent.clientY - startY;

          if (!isDragging && Math.sqrt(dx * dx + dy * dy) > 5) {
            isDragging = true;

            // 创建幽灵元素
            ghostEl = source.cloneNode(true);
            ghostEl.style.cssText = `
              position: fixed;
              pointer-events: none;
              opacity: 0.7;
              z-index: 99999;
              transform: rotate(2deg);
              box-shadow: 0 8px 24px rgba(0, 0, 0, 0.3);
            `;
            const rect = source.getBoundingClientRect();
            ghostEl.style.width = rect.width + 'px';
            ghostEl.style.height = rect.height + 'px';
            document.body.appendChild(ghostEl);

            source.style.opacity = '0.4';
          }

          if (isDragging && ghostEl) {
            ghostEl.style.left = (moveEvent.clientX - 30) + 'px';
            ghostEl.style.top = (moveEvent.clientY - 15) + 'px';
            opts.onMove && opts.onMove(moveEvent.clientX, moveEvent.clientY);
          }
        };

        const onMouseUp = (upEvent) => {
          document.removeEventListener('mousemove', onMouseMove);
          document.removeEventListener('mouseup', onMouseUp);

          if (isDragging) {
            source.style.opacity = '';
            if (ghostEl) {
              ghostEl.remove();
              ghostEl = null;
            }

            // 查找目标元素
            const target = document.elementFromPoint(upEvent.clientX, upEvent.clientY);
            if (target && (!opts.accepts || opts.accepts(target, data))) {
              opts.onDrop && opts.onDrop(target, data);
            }
          }

          isDragging = false;
        };

        document.addEventListener('mousemove', onMouseMove);
        document.addEventListener('mouseup', onMouseUp);
      };

      source.addEventListener('mousedown', onMouseDown);

      return () => {
        source.removeEventListener('mousedown', onMouseDown);
        if (ghostEl) {
          ghostEl.remove();
          ghostEl = null;
        }
      };
    },
  };
}