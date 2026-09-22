/**
 * @module plugins/pluginDialog
 * @description 对话框工具 - 基于现有 modal 组件封装
 *
 * 提供：
 *   - confirm：确认框（替代原生 confirm）
 *   - prompt：输入框（替代原生 prompt）
 *   - alert：提示框
 *   - form：多字段表单
 *
 */

/**
 * 为某插件创建 dialog 对象
 * @param {string} pluginId
 * @param {Object} manifest
 * @returns {Object}
 */
export function createPluginDialog(pluginId, manifest) {
  /**
   * 打开模态框并返回结果
   *
   * @param {string} html
   * @param {Object} [opts]
   * @param {Function} [opts.setup] - (modalContent, done) => void
   *   `done(value)` 会设置返回值并关闭 modal
   * @returns {Promise<*>}
   */
  async function openDialog(html, opts = {}) {
    let modalModule;
    try {
      modalModule = await import('../ui/components/modal.js');
    } catch (err) {
      console.error('[PluginDialog] 加载 modal 组件失败:', err);
      return null;
    }

    const { openModal, closeModal } = modalModule;

    return new Promise((resolve) => {
      let settled = false;
      let pendingValue = null;

      const safeResolve = (value) => {
        if (settled) return;
        settled = true;
        resolve(value);
      };

      // 无论 X / 遮罩 / 程序调用 closeModal，都会触发此回调
      openModal(html, () => {
        safeResolve(pendingValue);
      });

      const modalContent = document.getElementById('modalContent');
      if (!modalContent) {
        // 内容节点缺失（理论不会发生），主动关闭以触发 onClose
        try { closeModal(); } catch (_) {}
        return;
      }

      // 让调用方注入自定义逻辑
      if (typeof opts.setup === 'function') {
        try {
          opts.setup(modalContent, (value) => {
            // closeModal 会触发 onClose，进而 safeResolve(pendingValue)
            pendingValue = value;
            closeModal();
          });
        } catch (err) {
          console.error('[PluginDialog] setup 回调失败:', err);
          // 通过 closeModal 触发 onClose，pendingValue 仍为 null
          try { closeModal(); } catch (_) {}
        }
      }
    });
  }

  return {
    /**
     * 确认框
     * @param {string} message
     * @param {Object} [opts]
     * @param {string} [opts.title='确认']
     * @param {string} [opts.okText='确定']
     * @param {string} [opts.cancelText='取消']
     * @param {boolean} [opts.danger=false] - 危险操作（红色按钮）
     * @returns {Promise<boolean>}
     */
    confirm(message, opts = {}) {
      const {
        title = '确认',
        okText = '确定',
        cancelText = '取消',
        danger = false,
      } = opts;

      const html = `
        <button class="modal-close">&times;</button>
        <h2 class="modal-title">${escapeHtml(title)}</h2>
        <div style="padding: 0.5rem 0; font-size: 0.95rem; line-height: 1.7; white-space: pre-wrap;">${escapeHtml(message)}</div>
        <div style="display: flex; gap: 0.5rem; justify-content: flex-end; margin-top: 1rem;">
          <button class="btn btn-secondary" data-action="cancel">${escapeHtml(cancelText)}</button>
          <button class="btn ${danger ? 'btn-danger' : 'btn-primary'}" data-action="ok">${escapeHtml(okText)}</button>
        </div>
      `;

      return openDialog(html, {
        setup: (content, done) => {
          const cancelBtn = content.querySelector('[data-action="cancel"]');
          const okBtn = content.querySelector('[data-action="ok"]');
          if (cancelBtn) cancelBtn.addEventListener('click', () => done(false));
          if (okBtn) okBtn.addEventListener('click', () => done(true));
        },
      }).then(v => v === true);
    },

    /**
     * 输入框
     * @param {string} message
     * @param {string} [defaultValue='']
     * @param {Object} [opts]
     * @param {string} [opts.title='输入']
     * @param {string} [opts.placeholder='']
     * @param {string} [opts.okText='确定']
     * @param {string} [opts.cancelText='取消']
     * @param {string} [opts.inputType='text'] - 'text' | 'number' | 'password'
     * @returns {Promise<string|null>}
     */
    prompt(message, defaultValue = '', opts = {}) {
      const {
        title = '输入',
        placeholder = '',
        okText = '确定',
        cancelText = '取消',
        inputType = 'text',
      } = opts;

      const html = `
        <button class="modal-close">&times;</button>
        <h2 class="modal-title">${escapeHtml(title)}</h2>
        <div style="padding: 0.5rem 0;">
          ${message ? `<div style="margin-bottom: 0.5rem; font-size: 0.95rem;">${escapeHtml(message)}</div>` : ''}
          <input type="${escapeHtml(inputType)}" id="plugin-dialog-input"
                 value="${escapeHtml(defaultValue)}"
                 placeholder="${escapeHtml(placeholder)}"
                 style="width: 100%;">
        </div>
        <div style="display: flex; gap: 0.5rem; justify-content: flex-end; margin-top: 1rem;">
          <button class="btn btn-secondary" data-action="cancel">${escapeHtml(cancelText)}</button>
          <button class="btn btn-primary" data-action="ok">${escapeHtml(okText)}</button>
        </div>
      `;

      return openDialog(html, {
        setup: (content, done) => {
          const input = content.querySelector('#plugin-dialog-input');
          const cancelBtn = content.querySelector('[data-action="cancel"]');
          const okBtn = content.querySelector('[data-action="ok"]');

          if (input) {
            setTimeout(() => { input.focus(); input.select(); }, 50);
            input.addEventListener('keydown', (e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                done(input.value);
              } else if (e.key === 'Escape') {
                e.preventDefault();
                done(null);
              }
            });
          }

          if (cancelBtn) cancelBtn.addEventListener('click', () => done(null));
          if (okBtn) okBtn.addEventListener('click', () => {
            done(input ? input.value : null);
          });
        },
      });
    },

    /**
     * 提示框
     * @param {string} message
     * @param {Object} [opts]
     * @param {string} [opts.title='提示']
     * @param {string} [opts.okText='知道了']
     * @param {string} [opts.type='info'] - 'info' | 'success' | 'warning' | 'error'
     * @returns {Promise<void>}
     */
    alert(message, opts = {}) {
      const {
        title = '提示',
        okText = '知道了',
        type = 'info',
      } = opts;

      const iconMap = {
        info: 'fa-info-circle',
        success: 'fa-check-circle',
        warning: 'fa-exclamation-triangle',
        error: 'fa-exclamation-circle',
      };
      const colorMap = {
        info: 'var(--color-primary)',
        success: 'var(--color-secondary)',
        warning: 'var(--color-warning)',
        error: 'var(--color-danger)',
      };
      const icon = iconMap[type] || iconMap.info;
      const color = colorMap[type] || colorMap.info;

      const html = `
        <button class="modal-close">&times;</button>
        <h2 class="modal-title"><i class="fas ${icon}" style="color: ${color};"></i> ${escapeHtml(title)}</h2>
        <div style="padding: 0.5rem 0; font-size: 0.95rem; line-height: 1.7; white-space: pre-wrap;">${escapeHtml(message)}</div>
        <div style="display: flex; gap: 0.5rem; justify-content: flex-end; margin-top: 1rem;">
          <button class="btn btn-primary" data-action="ok">${escapeHtml(okText)}</button>
        </div>
      `;

      return openDialog(html, {
        setup: (content, done) => {
          const okBtn = content.querySelector('[data-action="ok"]');
          if (okBtn) okBtn.addEventListener('click', () => done(undefined));
        },
      }).then(() => undefined);
    },

    /**
     * 多字段表单
     * @param {Object} config
     * @param {string} config.title
     * @param {Array} config.fields - 字段定义数组
     * @param {string} [config.okText='确定']
     * @param {string} [config.cancelText='取消']
     * @returns {Promise<Object|null>}
     *
     * 字段类型：
     *   { name, label, type: 'text' | 'number' | 'password' | 'textarea' | 'select' | 'checkbox', value, ... }
     */
    form(config) {
      const {
        title = '编辑',
        fields = [],
        okText = '确定',
        cancelText = '取消',
      } = config;

      let fieldsHtml = '';
      for (const field of fields) {
        const { name, label, type = 'text', value = '', placeholder = '', options = [], min, max, step, help } = field;
        const id = `plugin-form-${pluginId}-${name}`;

        fieldsHtml += `<div class="form-group" style="margin-bottom: 0.8rem;">`;
        fieldsHtml += `<label for="${id}" style="display:block; font-weight: 500; margin-bottom: 0.25rem; font-size: 0.875rem;">${escapeHtml(label || name)}</label>`;

        if (type === 'textarea') {
          fieldsHtml += `<textarea id="${id}" data-field="${escapeHtml(name)}" rows="3" placeholder="${escapeHtml(placeholder)}">${escapeHtml(value)}</textarea>`;
        } else if (type === 'select') {
          fieldsHtml += `<select id="${id}" data-field="${escapeHtml(name)}">`;
          for (const opt of options) {
            const optValue = typeof opt === 'object' ? opt.value : opt;
            const optLabel = typeof opt === 'object' ? opt.label : opt;
            const selected = String(value) === String(optValue) ? 'selected' : '';
            fieldsHtml += `<option value="${escapeHtml(optValue)}" ${selected}>${escapeHtml(optLabel)}</option>`;
          }
          fieldsHtml += `</select>`;
        } else if (type === 'checkbox') {
          fieldsHtml = fieldsHtml.replace(`<label for="${id}"`, `<label style="display:flex; align-items:center; gap: 0.5rem;"`);
          fieldsHtml += `<input type="checkbox" id="${id}" data-field="${escapeHtml(name)}" ${value ? 'checked' : ''} style="width: auto;">`;
          fieldsHtml += `<span style="font-weight: 500; font-size: 0.875rem;">${escapeHtml(label || name)}</span>`;
          fieldsHtml = fieldsHtml.replace(`<label for="${id}" style="display:block; font-weight: 500; margin-bottom: 0.25rem; font-size: 0.875rem;">${escapeHtml(label || name)}</label>`, '');
        } else {
          const attrs = [];
          if (min !== undefined) attrs.push(`min="${min}"`);
          if (max !== undefined) attrs.push(`max="${max}"`);
          if (step !== undefined) attrs.push(`step="${step}"`);
          fieldsHtml += `<input type="${escapeHtml(type)}" id="${id}" data-field="${escapeHtml(name)}" value="${escapeHtml(value)}" placeholder="${escapeHtml(placeholder)}" ${attrs.join(' ')} style="width: 100%;">`;
        }

        if (help) {
          fieldsHtml += `<span class="help-text" style="display:block; font-size: 0.75rem; color: var(--color-text-muted); margin-top: 0.15rem;">${escapeHtml(help)}</span>`;
        }

        fieldsHtml += `</div>`;
      }

      const html = `
        <button class="modal-close">&times;</button>
        <h2 class="modal-title">${escapeHtml(title)}</h2>
        <div style="padding: 0.5rem 0; max-height: 60vh; overflow-y: auto;">
          ${fieldsHtml}
        </div>
        <div style="display: flex; gap: 0.5rem; justify-content: flex-end; margin-top: 1rem;">
          <button class="btn btn-secondary" data-action="cancel">${escapeHtml(cancelText)}</button>
          <button class="btn btn-primary" data-action="ok">${escapeHtml(okText)}</button>
        </div>
      `;

      return openDialog(html, {
        setup: (content, done) => {
          const cancelBtn = content.querySelector('[data-action="cancel"]');
          const okBtn = content.querySelector('[data-action="ok"]');

          if (cancelBtn) cancelBtn.addEventListener('click', () => done(null));
          if (okBtn) okBtn.addEventListener('click', () => {
            const result = {};
            const elements = content.querySelectorAll('[data-field]');
            elements.forEach(el => {
              const fieldName = el.dataset.field;
              if (el.type === 'checkbox') {
                result[fieldName] = el.checked;
              } else if (el.type === 'number') {
                const num = parseFloat(el.value);
                result[fieldName] = isNaN(num) ? el.value : num;
              } else {
                result[fieldName] = el.value;
              }
            });
            done(result);
          });
        },
      });
    },
  };
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = String(text == null ? '' : text);
  return div.innerHTML;
}