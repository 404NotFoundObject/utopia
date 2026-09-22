/**
 * @module ui/screens/settingsUI/sections/danger
 * @description 危险操作 section（使用指南 + 重置所有数据）
 */

import { deleteDatabase } from '../../../../core/db.js';
import { deleteVfsDatabase } from '../../../../plugins/pluginVfs.js';

export function renderDangerSection(settings, ctx) {
  return `
    <div style="display:flex;gap:0.5rem;margin:1rem 0;">
      <button class="btn btn-sm" id="helpBtn">📖 使用指南</button>
    </div>

    <div class="settings-section" style="margin-top: 2rem; border-top: 2px solid var(--color-danger); padding-top: 1rem;">
      <h3 style="color: var(--color-danger);">⚠️ 危险操作</h3>
      <div class="setting-row">
        <button class="btn btn-danger" id="resetAllDataBtn" style="padding: 0.6rem 2rem;">
          🗑️ 重置所有数据
        </button>
        <span class="help-text">将清空所有数据（角色、会话、记忆、世界书、插件、自定义主题等），不可恢复</span>
      </div>
    </div>
  `;
}

export function bindDangerSection(modalContent, ctx) {
  const helpBtn = modalContent.querySelector('#helpBtn');
  if (helpBtn) {
    helpBtn.addEventListener('click', () => {
      import('../../helpUI.js').then(m => m.renderHelpModal());
    });
  }

  const resetBtn = modalContent.querySelector('#resetAllDataBtn');
  if (resetBtn) {
    resetBtn.addEventListener('click', async () => {
      if (!confirm('⚠️ 确定要重置所有数据吗？此操作不可恢复！')) return;
      if (!confirm('⚠️ 再次确认：所有数据（角色、会话、记忆、世界书、插件、自定义主题等）将被永久删除！')) return;

      try {
        // ---------- 主数据库 ----------
        await deleteDatabase();

        // ---------- AUD-9：插件数据库 ----------
        try {
          await deleteVfsDatabase();
        } catch (e) {
          console.warn('[Settings/Danger] 插件库删除失败（继续清理 localStorage）:', e);
          // 不阻塞流程，继续清理 localStorage
        }

        // ---------- AUD-10：localStorage 清理 ----------
        const keysToRemove = [
          'utopia_app_version',
          'lastMode',
          'lastCharacterId',
          'lastGroupId',
          'utopia-theme',
          'utopia_db_version',
          'utopia:custom-themes',       // AUD-10：自定义主题
        ];
        for (const key of keysToRemove) {
          localStorage.removeItem(key);
        }

        ctx.showToast('✅ 数据已重置，页面即将刷新', 'success');
        setTimeout(() => location.reload(), 1500);
      } catch (err) {
        console.error('[Settings/Danger] 重置失败:', err);
        ctx.showToast('❌ 重置失败: ' + err.message, 'error');
      }
    });
  }
}