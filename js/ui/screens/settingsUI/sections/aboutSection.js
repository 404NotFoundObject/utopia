/**
 * @module ui/screens/settingsUI/sections/about
 * @description 关于 section（版本号展示 + 主动检查更新 + 缓存重载）
 *
 * P3-10 阶段 B：
 *   - 此前版本号只存在于 app.js 内部常量，界面上无处可查，
 *     「用户跑的是哪一版」全靠猜（v3.9.3 反馈「修复没生效」时无法自证）
 *   - 检查更新原先依赖「已加载代码里的 APP_VERSION」，而 Service Worker
 *     对静态资源走 stale-while-revalidate → 长期不关页面就永远探测不到新版本。
 *     这里改为调用 js/core/updateChecker 的独立版本通道 version.json。
 */

import {
  checkForUpdate,
  clearAppCaches,
  applyUpdate,
  getUpdateState,
  getLocalVersion,
} from '../../../../core/updateChecker.js';

function formatTime(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

export function renderAboutSection(settings, ctx) {
  const state = getUpdateState();
  const version = getLocalVersion();

  return `
    <div class="settings-section">
      <h3>关于</h3>
      <div class="setting-row">
        <label>当前版本</label>
        <span id="aboutAppVersion" style="font-family: monospace;">v${ctx.escapeHtml(version)}</span>
      </div>
      <div class="setting-row">
        <span id="aboutLastCheck" style="font-family: monospace;">最后检查时间：${ctx.escapeHtml(formatTime(state.lastCheckedAt))}</span>
        <span class="help-text">每 30 分钟自动检查一次，页面重新可见时也会补检查</span>
      </div>
      <div style="display:flex;gap:0.5rem;margin:0.75rem 0;flex-wrap:wrap;">
        <button class="btn btn-sm" id="checkUpdateBtn">🔄 检查更新</button>
        <button class="btn btn-sm" id="reloadCacheBtn">🧹 清除缓存并重载</button>
      </div>
      <div class="help-text" id="aboutUpdateStatus">尚未检查</div>
    </div>
  `;
}

export function bindAboutSection(modalContent, ctx) {
  const checkBtn = modalContent.querySelector('#checkUpdateBtn');
  const reloadBtn = modalContent.querySelector('#reloadCacheBtn');
  const statusEl = modalContent.querySelector('#aboutUpdateStatus');
  const lastCheckEl = modalContent.querySelector('#aboutLastCheck');

  const setStatus = (text) => {
    if (statusEl) statusEl.textContent = text;
  };

  if (checkBtn) {
    checkBtn.addEventListener('click', async () => {
      checkBtn.disabled = true;
      checkBtn.textContent = '检查中…';
      setStatus('正在读取版本信息…');
      try {
        const result = await checkForUpdate();
        if (lastCheckEl) lastCheckEl.textContent = '最后检查时间：' + formatTime(getUpdateState().lastCheckedAt);

        if (result.status === 'unavailable') {
          setStatus('无法获取版本信息（可能处于离线状态），可稍后重试');
          ctx.showToast('暂时无法连接版本服务', 'info');
        } else if (result.hasUpdate) {
          setStatus(`发现新版本 v${result.remote}，点击右侧「立即更新」应用`);
          // 设置面板内直接给出落地入口：不必关掉面板等横幅
          const applyBtn = document.createElement('button');
          applyBtn.className = 'btn btn-sm btn-primary';
          applyBtn.textContent = `⬆ 更新到 v${result.remote}`;
          applyBtn.style.marginLeft = '0.5rem';
          applyBtn.addEventListener('click', () => {
            applyBtn.disabled = true;
            applyBtn.textContent = '更新中…';
            applyUpdate().catch((err) => {
              console.error('[Settings/About] 应用更新失败:', err);
              applyBtn.disabled = false;
              applyBtn.textContent = '重试';
            });
          });
          if (statusEl) statusEl.appendChild(applyBtn);
          ctx.showToast(`发现新版本 v${result.remote}`, 'info');
        } else {
          setStatus(`已是最新版本（v${result.local}）`);
          ctx.showToast('已是最新版本', 'success');
        }
      } catch (err) {
        console.error('[Settings/About] 检查更新失败:', err);
        setStatus('检查失败：' + (err?.message || '未知错误'));
      } finally {
        checkBtn.disabled = false;
        checkBtn.textContent = '🔄 检查更新';
      }
    });
  }

  if (reloadBtn) {
    reloadBtn.addEventListener('click', async () => {
      if (!confirm('将清除本地缓存并重新加载页面。确定继续吗？')) return;
      reloadBtn.disabled = true;
      try {
        const cleared = await clearAppCaches();
        ctx.showToast(`已清理 ${cleared} 个缓存，页面即将重载`, 'success');
        setTimeout(() => location.reload(), 800);
      } catch (err) {
        reloadBtn.disabled = false;
        console.error('[Settings/About] 清缓存失败:', err);
        ctx.showToast('清理缓存失败：' + err.message, 'error');
      }
    });
  }
}
