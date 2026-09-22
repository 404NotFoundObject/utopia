// 模态框组件
import { escapeHtml } from '../../core/utils.js';

const overlay = document.getElementById('modalOverlay');
const content = document.getElementById('modalContent');

let _overlayClickHandler = null;
let _onCloseCallback = null;

function _attachOverlayHandler() {
  _detachOverlayHandler();
  _overlayClickHandler = (e) => {
    if (e.target === overlay) closeModal();
  };
  overlay.addEventListener('click', _overlayClickHandler);
}

function _detachOverlayHandler() {
  if (_overlayClickHandler) {
    overlay.removeEventListener('click', _overlayClickHandler);
    _overlayClickHandler = null;
  }
}

function _fireOnCloseCallback() {
  if (!_onCloseCallback) return;
  const cb = _onCloseCallback;
  _onCloseCallback = null;
  try {
    cb();
  } catch (err) {
    console.error('[Modal] onClose 回调执行失败:', err);
  }
}

/**
 * 打开模态框
 *
 * @param {string} htmlContent - 模态框的 HTML 内容（调用方负责安全）
 *   项目内调用方通常用字符串模板拼接，用户输入已通过 escapeHtml 转义。
 * @param {Function} [onClose] - 关闭时的回调
 */
export function openModal(htmlContent, onClose) {
  _fireOnCloseCallback();

  content.innerHTML = htmlContent;
  overlay.classList.remove('hidden');
  _attachOverlayHandler();

  const closeBtn = content.querySelector('.modal-close');
  if (closeBtn) {
    closeBtn.addEventListener('click', closeModal);
  }

  _onCloseCallback = typeof onClose === 'function' ? onClose : null;
}

export function closeModal() {
  overlay.classList.add('hidden');
  _detachOverlayHandler();
  _fireOnCloseCallback();
}

/**
 * 创建模态框 HTML
 *
 * ★ XSS 修复：
 *   - title 是纯文本语义，经过 escapeHtml
 *   - bodyHtml / footerHtml 是 HTML 语义，由调用方负责安全
 *
 * 注：此函数当前无调用方（预留给未来的标准模态框构建），
 *     修复是为防止未来误用。
 *
 * @param {string} title - 标题（纯文本）
 * @param {string} bodyHtml - 主体 HTML（调用方负责安全）
 * @param {string} [footerHtml=''] - 底部 HTML（调用方负责安全）
 */
export function createModal(title, bodyHtml, footerHtml = '') {
  return `
    <button class="modal-close">&times;</button>
    <h2 class="modal-title">${escapeHtml(title)}</h2>
    ${bodyHtml}
    ${footerHtml ? `<div class="modal-footer">${footerHtml}</div>` : ''}
  `;
}