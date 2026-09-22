// Toast 提示
import { escapeHtml } from '../../core/utils.js';

const container = document.getElementById('toastContainer');

/**
 * 显示 Toast 提示
 *
 * ★ XSS 修复：
 *   - message 经过 escapeHtml，防止从 API 错误信息 / 用户输入回显注入 HTML
 *   - type 经过白名单校验，防止 class 注入（如 type="foo\" onclick=\"..."）
 */
export function showToast(message, type = 'info', duration = 3000) {
  const toast = document.createElement('div');

  // ★ type 白名单校验
  const safeType = ['success', 'error', 'warning', 'info'].includes(type) ? type : 'info';
  toast.className = `toast toast-${safeType}`;

  const iconMap = {
    success: 'fa-check-circle',
    error: 'fa-exclamation-circle',
    warning: 'fa-exclamation-triangle',
    info: 'fa-info-circle',
  };

  // ★ message 转义（先转字符串再 escape）
  const safeMessage = escapeHtml(message);

  toast.innerHTML = `
    <i class="fas ${iconMap[safeType]} toast-icon"></i>
    <span class="toast-msg">${safeMessage}</span>
  `;
  container.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(-10px)';
    setTimeout(() => toast.remove(), 300);
  }, duration);
}