// js/pwa.js - PWA：Service Worker 注册与版本更新提示
//
// 纯增量接入：注册失败（非安全上下文 / 浏览器不支持）时静默降级，
// 不影响应用其余功能；发现新版本时用 toast 提示用户手动刷新，
// 不自动重载，避免打断进行中的对话输入。

import { showToast } from './ui/components/toast.js';

export function initPWA() {
  if (!('serviceWorker' in navigator)) return;
  // file:// 或非安全上下文（除 localhost 外的 http）无法注册 SW
  if (location.protocol !== 'http:' && location.protocol !== 'https:') return;

  window.addEventListener('load', () => {
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
