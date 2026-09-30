// js/pwa.js - PWA：Service Worker 注册与版本更新提示
//
// 纯增量接入：注册失败（非安全上下文 / 浏览器不支持）时静默降级，
// 不影响应用其余功能；发现新版本时用 toast 提示用户手动刷新，
// 不自动重载，避免打断进行中的对话输入。

import { showToast } from './ui/components/toast.js';

// 窗口装饰器 / 浏览器 UI 色（PWA 标题栏、地址栏）跟随当前主题底色
function syncThemeColor() {
  const meta = document.querySelector('meta[name="theme-color"]');
  if (!meta) return;
  const color = getComputedStyle(document.documentElement)
    .getPropertyValue('--color-bg-secondary')
    .trim();
  if (color) meta.setAttribute('content', color);
}

export function initPWA() {
  if (window.__eventBus && typeof window.__eventBus.on === 'function') {
    window.__eventBus.on('theme:changed', syncThemeColor);
  }

  if (!('serviceWorker' in navigator)) return;
  // file:// 或非安全上下文（除 localhost 外的 http）无法注册 SW
  if (location.protocol !== 'http:' && location.protocol !== 'https:') return;

  window.addEventListener('load', () => {
    // 主题变量由 theme.js 在启动流程中注入，须等其就绪后再取色
    syncThemeColor();
    setTimeout(syncThemeColor, 300);

    navigator.serviceWorker
      .register('./sw.js')
      .then((reg) => {
        reg.addEventListener('updatefound', () => {
          const next = reg.installing;
          if (!next) return;
          next.addEventListener('statechange', () => {
            // 首次安装（页面尚未被 SW 控制）不打扰；仅升级场景提示
            if (next.state === 'installed' && navigator.serviceWorker.controller) {
              showToast('新版本已就绪，刷新页面后生效', 'info');
            }
          });
        });
      })
      .catch(() => { /* SW 不可用：静默降级 */ });
  });
}

initPWA();
