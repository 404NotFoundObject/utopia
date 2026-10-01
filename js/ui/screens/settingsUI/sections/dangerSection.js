/**
 * @module ui/screens/settingsUI/sections/danger
 * @description 危险操作 section（使用指南 + 重置所有数据）
 */

import { deleteDatabase, getStores } from '../../../../core/db.js';
import { deleteVfsDatabase } from '../../../../plugins/pluginVfs.js';

export function renderDangerSection(settings, ctx) {
  return `
    <div style="display:flex;gap:0.5rem;margin:1rem 0;">
      <button class="btn btn-sm" id="helpBtn">📖 使用指南</button>
      <button class="btn btn-sm" id="exportAllDataBtn">📦 导出数据备份</button>
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

  const exportBtn = modalContent.querySelector('#exportAllDataBtn');
  if (exportBtn) {
    exportBtn.addEventListener('click', async () => {
      try {
        const stores = await getStores();
        const dump = {};
        for (const [name, store] of Object.entries(stores)) {
          dump[name] = await store.getAll();
        }
        // 顺带把 localStorage 里的关键键也纳入备份
        const ls = {};
        for (let i = 0; i < localStorage.length; i++) {
          const key = localStorage.key(i);
          if (key && key.startsWith('utopia')) ls[key] = localStorage.getItem(key);
        }
        dump._localStorage = ls;

        const blob = new Blob([JSON.stringify(dump, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `utopia-backup-${new Date().toISOString().slice(0, 10)}.json`;
        a.click();
        URL.revokeObjectURL(url);
        ctx.showToast('✅ 数据已导出为 JSON 备份文件', 'success');
      } catch (err) {
        console.error('[Settings/Danger] 导出失败:', err);
        ctx.showToast('❌ 导出失败: ' + err.message, 'error');
      }
    });
  }

  const resetBtn = modalContent.querySelector('#resetAllDataBtn');
  if (resetBtn) {
    resetBtn.addEventListener('click', async () => {
      if (!confirm('⚠️ 确定要重置所有数据吗？此操作不可恢复！')) return;
      if (!confirm('⚠️ 再次确认：所有数据（角色、会话、记忆、世界书、插件、自定义主题等）将被永久删除！')) return;

      const results = [];
      let anyFailure = false;

      // ---------- 主数据库 ----------
      try {
        await deleteDatabase();
        results.push('主数据库：✅ 已删除');
      } catch (err) {
        anyFailure = true;
        console.error('[Settings/Danger] 主数据库删除失败:', err);
        results.push('主数据库：❌ 删除失败（' + err.message + '）');
      }

      // ---------- 插件数据库 ----------
      try {
        await deleteVfsDatabase();
        results.push('插件库：✅ 已删除');
      } catch (err) {
        anyFailure = true;
        console.warn('[Settings/Danger] 插件库删除失败:', err);
        results.push('插件库：❌ 删除失败（可能残留插件数据）');
      }

      // ---------- localStorage 清理 ----------
      const keysToRemove = [
        'utopia_app_version',
        'lastMode',
        'lastCharacterId',
        'lastGroupId',
        'utopia-theme',
        'utopia_db_version',
        'utopia:custom-themes',       // 自定义主题
        'utopia:dev-monitor',         // 开发监控
        'utopia:wx-social-cover',     // 微信主题朋友圈封面
      ];
      for (const key of keysToRemove) {
        localStorage.removeItem(key);
      }
      results.push('本地缓存：✅ 已清理');

      if (anyFailure) {
        // 分步报告：明确告知哪些失败、哪些残留
        const summary = results.join('\n');
        ctx.showToast('⚠️ 部分数据删除失败，详见控制台', 'error');
        alert('重置结果（部分失败）：\n\n' + summary + '\n\n请勿立即刷新，可先导出备份后重试。');
      } else {
        ctx.showToast('✅ 数据已重置，页面即将刷新', 'success');
        setTimeout(() => location.reload(), 1500);
      }
    });
  }
}