/**
 * @module plugins/pluginDom
 * @description DOM 便捷方法
 *
 * 提供：
 *   - h()：快速创建元素
 *   - cssVar()：读取主题 CSS 变量
 *   - createIcon()：创建 Font Awesome 图标
 *   - observe()：监听元素出现/消失
 *   - debounce / throttle
 */

/**
 * 为某插件创建 dom 对象
 * @returns {Object}
 */
export function createPluginDom() {
  return {
    /**
     * 创建元素
     * @param {string} tag - 标签名，支持 `div.class#id`
     * @param {Object} [attrs] - 属性对象
     * @param {...(Node|string|Array)} children - 子节点
     * @returns {HTMLElement}
     *
     * @example
     * const btn = dom.h('button.btn.btn-primary', { onclick: fn }, '点击我');
     * const box = dom.h('div#container', { style: 'color: red;' }, [
     *   dom.h('span', 'Hello'),
     *   dom.h('span', 'World'),
     * ]);
     */
    h(tag, attrs, ...children) {
      // 解析 tag：div.class1.class2#id
      const parts = String(tag).split(/(?=[.#])/);
      const tagName = parts[0] || 'div';
      const el = document.createElement(tagName);

      for (let i = 1; i < parts.length; i++) {
        const part = parts[i];
        if (part.startsWith('.')) {
          el.classList.add(part.slice(1));
        } else if (part.startsWith('#')) {
          el.id = part.slice(1);
        }
      }

      // 处理 attrs
      if (attrs && typeof attrs === 'object' && !Array.isArray(attrs) && !(attrs instanceof Node)) {
        for (const [key, value] of Object.entries(attrs)) {
          if (value === null || value === undefined || value === false) continue;

          if (key === 'style' && typeof value === 'object') {
            Object.assign(el.style, value);
          } else if (key === 'dataset' && typeof value === 'object') {
            Object.assign(el.dataset, value);
          } else if (key === 'classList' && Array.isArray(value)) {
            value.forEach(c => el.classList.add(c));
          } else if (key.startsWith('on') && typeof value === 'function') {
            el.addEventListener(key.slice(2).toLowerCase(), value);
          } else if (key === 'innerHTML') {
            el.innerHTML = String(value);
          } else if (key === 'textContent') {
            el.textContent = String(value);
          } else {
            el.setAttribute(key, String(value));
          }
        }
      } else {
        // attrs 是子节点
        children.unshift(attrs);
      }

      // 处理子节点
      const appendChild = (child) => {
        if (child === null || child === undefined || child === false) return;
        if (Array.isArray(child)) {
          child.forEach(appendChild);
        } else if (child instanceof Node) {
          el.appendChild(child);
        } else {
          el.appendChild(document.createTextNode(String(child)));
        }
      };

      children.forEach(appendChild);
      return el;
    },

    /**
     * 读取 CSS 变量
     * @param {string} name - 变量名（含 `--` 前缀）
     * @param {string} [fallback='']
     */
    cssVar(name, fallback = '') {
      const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
      return value || fallback;
    },

    /**
     * 创建 Font Awesome 图标
     * @param {string} name - 图标名（如 'fa-star'）
     * @param {Object} [opts]
     * @param {string} [opts.size] - 如 '0.9rem'
     * @param {string} [opts.color]
     * @returns {HTMLElement}
     */
    createIcon(name, opts = {}) {
      const i = document.createElement('i');
      i.className = `fas ${name}`;
      if (opts.size) i.style.fontSize = opts.size;
      if (opts.color) i.style.color = opts.color;
      return i;
    },

    /**
     * 监听元素出现
     * @param {string} selector - CSS 选择器
     * @param {Function} callback - (element) => void
     * @param {Object} [opts]
     * @param {boolean} [opts.once=false] - 只触发一次
     * @param {number} [opts.timeout=0] - 超时时间（0 表示无限）
     * @returns {Function} 取消监听
     */
    observe(selector, callback, opts = {}) {
      const { once = false, timeout = 0 } = opts;
      let observer = null;
      let timer = null;
      let cancelled = false;

      // 立即检查
      const existing = document.querySelector(selector);
      if (existing) {
        setTimeout(() => {
          if (!cancelled) callback(existing);
        }, 0);
        if (once) return () => { cancelled = true; };
      }

      observer = new MutationObserver((mutations) => {
        if (cancelled) return;
        for (const m of mutations) {
          for (const node of m.addedNodes) {
            if (node.nodeType !== 1) continue;
            if (node.matches && node.matches(selector)) {
              callback(node);
              if (once) {
                observer.disconnect();
                return;
              }
            }
            if (node.querySelectorAll) {
              const found = node.querySelectorAll(selector);
              if (found.length > 0) {
                for (const el of found) {
                  callback(el);
                  if (once) {
                    observer.disconnect();
                    return;
                  }
                }
              }
            }
          }
        }
      });

      observer.observe(document.body, { childList: true, subtree: true });

      if (timeout > 0) {
        timer = setTimeout(() => {
          observer.disconnect();
        }, timeout);
      }

      return () => {
        cancelled = true;
        if (observer) observer.disconnect();
        if (timer) clearTimeout(timer);
      };
    },

    /**
     * 防抖
     */
    debounce(fn, delay = 300) {
      let timer;
      return (...args) => {
        clearTimeout(timer);
        timer = setTimeout(() => fn(...args), delay);
      };
    },

    /**
     * 节流
     */
    throttle(fn, delay = 300) {
      let last = 0;
      let timer;
      return (...args) => {
        const now = Date.now();
        const remaining = delay - (now - last);
        if (remaining <= 0) {
          last = now;
          fn(...args);
        } else if (!timer) {
          timer = setTimeout(() => {
            last = Date.now();
            timer = null;
            fn(...args);
          }, remaining);
        }
      };
    },

    /**
     * 等待元素出现
     * @param {string} selector
     * @param {number} [timeout=5000]
     * @returns {Promise<Element|null>}
     */
    waitFor(selector, timeout = 5000) {
      return new Promise((resolve) => {
        const existing = document.querySelector(selector);
        if (existing) {
          resolve(existing);
          return;
        }

        let resolved = false;
        const observer = new MutationObserver(() => {
          const el = document.querySelector(selector);
          if (el && !resolved) {
            resolved = true;
            observer.disconnect();
            resolve(el);
          }
        });

        observer.observe(document.body, { childList: true, subtree: true });

        setTimeout(() => {
          if (!resolved) {
            resolved = true;
            observer.disconnect();
            resolve(null);
          }
        }, timeout);
      });
    },

    /**
     * 转义 HTML
     */
    escapeHtml(text) {
      const div = document.createElement('div');
      div.textContent = String(text == null ? '' : text);
      return div.innerHTML;
    },

    /**
     * 从 HTML 字符串解析元素
     * @param {string} html
     * @returns {Element|null}
     */
    fromHTML(html) {
      const template = document.createElement('template');
      template.innerHTML = String(html).trim();
      return template.content.firstElementChild;
    },
  };
}