/**
 * @module banner
 * @description 旁白提示框组件 - 居中浮层，类似微信撤回提示
 */

import { escapeHtml } from '../../core/utils.js';

let bannerTimer = null;
let bannerElement = null;

/**
 * 显示旁白提示框
 * @param {string} text - 提示文本（支持 \n 换行）
 * @param {number} duration - 显示时长（毫秒），默认 3000
 * @param {string} type - 提示类型：'info' | 'success' | 'error' | 'warning'，默认 'info'
 */
export function showBanner(text, duration = 3000, type = 'info') {
  // 移除已有 banner
  if (bannerElement) {
    bannerElement.remove();
    bannerElement = null;
  }
  if (bannerTimer) {
    clearTimeout(bannerTimer);
    bannerTimer = null;
  }

  // 创建容器
  const container = document.createElement('div');
  // ★ type 白名单校验，防止被外部传入污染 class
  const safeType = ['info', 'success', 'error', 'warning'].includes(type) ? type : 'info';
  container.className = `banner-container banner-${safeType}`;

  // ★ XSS 修复：每一行转义
  const safeText = text === null || text === undefined ? '' : String(text);
  const lines = safeText.split('\n');
  const contentHtml = lines.map(line => {
    const trimmed = line.trim();
    // 保留原有的空行替代逻辑，但值经过转义
    return `<span class="banner-line">${trimmed ? escapeHtml(trimmed) : ' '}</span>`;
  }).join('');

  container.innerHTML = `
    <div class="banner-content">
      ${contentHtml}
    </div>
  `;

  document.body.appendChild(container);
  bannerElement = container;

  // 触发动画（延迟一帧确保 DOM 已渲染）
  requestAnimationFrame(() => {
    container.classList.add('banner-visible');
  });

  // 自动消失
  bannerTimer = setTimeout(() => {
    hideBanner();
  }, duration);

  // 点击关闭
  container.addEventListener('click', () => {
    hideBanner();
  });
}

/**
 * 隐藏旁白提示框
 */
export function hideBanner() {
  const el = bannerElement;
  if (el) {
    bannerElement = null;
    el.classList.remove('banner-visible');
    setTimeout(() => {
      if (el.parentNode) el.remove();
    }, 300);
  }
  if (bannerTimer) {
    clearTimeout(bannerTimer);
    bannerTimer = null;
  }
}

/**
 * 快捷方法：显示成功提示
 */
export function showSuccessBanner(text, duration = 3000) {
  showBanner(text, duration, 'success');
}

/**
 * 快捷方法：显示错误提示
 */
export function showErrorBanner(text, duration = 3000) {
  showBanner(text, duration, 'error');
}

/**
 * 快捷方法：显示警告提示
 */
export function showWarningBanner(text, duration = 3000) {
  showBanner(text, duration, 'warning');
}