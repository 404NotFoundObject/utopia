/**
 * @module ui/screens/pluginManagerUI
 * @description 插件管理界面 - 安装/启用/禁用/卸载/查看权限
 */

import { openModal, closeModal } from '../components/modal.js';
import { showToast } from '../components/toast.js';
import { getPermissionLabel } from '../../plugins/permissionChecker.js';

// ============================================================
// 主界面
// ============================================================

export async function renderPluginManagerModal() {
  let plugins = [];
  try {
    const { listInstalledPlugins } = await import('../../plugins/pluginManager.js');
    plugins = await listInstalledPlugins();
  } catch (err) {
    console.error('[PluginUI] 读取插件列表失败:', err);
    showToast('读取插件列表失败: ' + err.message, 'error');
    return;
  }

  const html = `
    <button class="modal-close">&times;</button>
    <h2 class="modal-title"><i class="fas fa-puzzle-piece"></i> 插件管理</h2>
    <div style="max-height: 70vh; overflow-y: auto;">
      <div style="display: flex; gap: 0.5rem; margin-bottom: 1rem; flex-wrap: wrap;">
        <button class="btn btn-primary btn-sm" id="pluginInstallUrlBtn">
          <i class="fas fa-link"></i> 从 URL 安装
        </button>
        <button class="btn btn-primary btn-sm" id="pluginInstallFileBtn">
          <i class="fas fa-upload"></i> 从文件安装
        </button>
        <button class="btn btn-secondary btn-sm" id="pluginRefreshBtn">
          <i class="fas fa-sync-alt"></i> 刷新
        </button>
      </div>
      <div id="pluginListContainer">
        ${renderPluginList(plugins)}
      </div>
    </div>
  `;

  openModal(html);
  bindEvents(plugins);
}

// ============================================================
// 插件列表
// ============================================================

function renderPluginList(plugins) {
  if (plugins.length === 0) {
    return `
      <div style="text-align: center; padding: 2rem; color: var(--color-text-muted);">
        <i class="fas fa-puzzle-piece" style="font-size: 3rem; opacity: 0.3;"></i>
        <p style="margin-top: 1rem;">暂无已安装插件</p>
        <p style="font-size: 0.85rem;">点击上方按钮安装插件</p>
      </div>
    `;
  }
  return plugins.map(renderPluginItem).join('');
}

function renderPluginItem(plugin) {
  const statusIcon = plugin.enabled ? '🟢' : '⚪';
  const statusText = plugin.enabled ? '已启用' : '未启用';
  const runningText = plugin.running ? ' · 运行中' : '';

  const permCount = (plugin.permissions || []).length;
  const hasWildcard = (plugin.permissions || []).includes('*');

  const escape = (s) => {
    const d = document.createElement('div');
    d.textContent = String(s == null ? '' : s);
    return d.innerHTML;
  };

  return `
    <div class="plugin-item" data-id="${escape(plugin.id)}" style="
      border: 1px solid var(--color-border);
      border-radius: var(--radius-md);
      padding: 0.8rem;
      margin-bottom: 0.6rem;
      background: var(--color-bg-secondary);
    ">
      <div style="display: flex; justify-content: space-between; align-items: start; gap: 0.5rem;">
        <div style="flex: 1; min-width: 0;">
          <div style="display: flex; align-items: center; gap: 0.4rem; margin-bottom: 0.3rem; flex-wrap: wrap;">
            <span>${statusIcon}</span>
            <strong style="font-size: 0.95rem;">${escape(plugin.name)}</strong>
            <span style="font-size: 0.75rem; color: var(--color-text-muted);">v${escape(plugin.version)}</span>
            ${hasWildcard ? '<span style="background: var(--color-danger); color: #fff; font-size: 0.65rem; padding: 0.05rem 0.4rem; border-radius: 999px;">⚠️ 全权限</span>' : ''}
          </div>
          <div style="font-size: 0.8rem; color: var(--color-text-secondary); margin-bottom: 0.3rem;">
            ${escape(plugin.description || '无描述')}
          </div>
          <div style="font-size: 0.7rem; color: var(--color-text-muted);">
            ${plugin.author ? '作者: ' + escape(plugin.author) : ''} · ${statusText}${runningText}
          </div>
        </div>
        <div style="display: flex; gap: 0.3rem; flex-shrink: 0; flex-wrap: wrap;">
          ${plugin.enabled
            ? `<button class="btn btn-sm plugin-disable-btn" data-id="${escape(plugin.id)}" title="禁用">禁用</button>`
            : `<button class="btn btn-primary btn-sm plugin-enable-btn" data-id="${escape(plugin.id)}" title="启用">启用</button>`
          }
          <button class="icon-btn plugin-detail-btn" data-id="${escape(plugin.id)}" title="详情">
            <i class="fas fa-info-circle"></i>
          </button>
          <button class="icon-btn plugin-delete-btn" data-id="${escape(plugin.id)}" title="卸载" style="color: var(--color-danger);">
            <i class="fas fa-trash"></i>
          </button>
        </div>
      </div>
      ${permCount > 0 ? `
        <div style="margin-top: 0.5rem; font-size: 0.75rem; color: var(--color-text-muted);">
          <i class="fas fa-key"></i> ${permCount} 项权限
        </div>
      ` : ''}
    </div>
  `;
}

// ============================================================
// 事件绑定
// ============================================================

function bindEvents(plugins) {
  const modalContent = document.getElementById('modalContent');
  if (!modalContent) return;

  // 从 URL 安装
  const urlBtn = modalContent.querySelector('#pluginInstallUrlBtn');
  if (urlBtn) {
    urlBtn.addEventListener('click', () => openUrlInstallDialog());
  }

  // 从文件安装
  const fileBtn = modalContent.querySelector('#pluginInstallFileBtn');
  if (fileBtn) {
    fileBtn.addEventListener('click', () => openFileInstallDialog());
  }

  // 刷新
  const refreshBtn = modalContent.querySelector('#pluginRefreshBtn');
  if (refreshBtn) {
    refreshBtn.addEventListener('click', () => {
      closeModal();
      renderPluginManagerModal();
    });
  }

  // 启用
  modalContent.querySelectorAll('.plugin-enable-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id = btn.dataset.id;
      const originalText = btn.textContent;
      try {
        btn.disabled = true;
        btn.textContent = '启用中...';
        const { enablePlugin } = await import('../../plugins/pluginManager.js');
        await enablePlugin(id);
        closeModal();
        renderPluginManagerModal();
      } catch (err) {
        showToast('启用失败: ' + err.message, 'error');
        btn.disabled = false;
        btn.textContent = originalText;
      }
    });
  });

  // 禁用
  modalContent.querySelectorAll('.plugin-disable-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id = btn.dataset.id;
      if (!confirm('确定禁用此插件吗？')) return;
      const originalText = btn.textContent;
      try {
        btn.disabled = true;
        btn.textContent = '禁用中...';
        const { disablePlugin } = await import('../../plugins/pluginManager.js');
        await disablePlugin(id);
        closeModal();
        renderPluginManagerModal();
      } catch (err) {
        showToast('禁用失败: ' + err.message, 'error');
        btn.disabled = false;
        btn.textContent = originalText;
      }
    });
  });

  // 卸载
  modalContent.querySelectorAll('.plugin-delete-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id = btn.dataset.id;
      if (!confirm('确定卸载插件 "' + id + '" 吗？此操作不可恢复。')) return;
      try {
        const { uninstallPlugin } = await import('../../plugins/pluginInstaller.js');
        await uninstallPlugin(id, { skipConfirm: true });
        closeModal();
        renderPluginManagerModal();
      } catch (err) {
        showToast('卸载失败: ' + err.message, 'error');
      }
    });
  });

  // 详情
  modalContent.querySelectorAll('.plugin-detail-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.id;
      const plugin = plugins.find(p => p.id === id);
      if (plugin) showPluginDetail(plugin);
    });
  });
}

// ============================================================
// URL 安装对话框
// ============================================================

function openUrlInstallDialog() {
  const html = `
    <button class="modal-close">&times;</button>
    <h3 class="modal-title">从 URL 安装</h3>
    <div class="form-group">
      <label>插件包 URL（.zip）</label>
      <input type="text" id="pluginUrlInput" placeholder="https://example.com/plugin.zip" style="width: 100%;">
      <span class="help-text">支持直链，或 GitHub Release 的下载地址</span>
    </div>
    <div id="pluginUrlStatus" style="margin: 0.5rem 0; font-size: 0.85rem; color: var(--color-text-muted); min-height: 1.2em;"></div>
    <div style="display: flex; gap: 0.5rem; justify-content: flex-end; margin-top: 1rem;">
      <button class="btn btn-secondary" id="pluginUrlCancel">取消</button>
      <button class="btn btn-primary" id="pluginUrlInstall">安装</button>
    </div>
  `;
  openModal(html);

  const modalContent = document.getElementById('modalContent');
  if (!modalContent) return;

  const cancelBtn = modalContent.querySelector('#pluginUrlCancel');
  const installBtn = modalContent.querySelector('#pluginUrlInstall');

  cancelBtn.addEventListener('click', () => {
    closeModal();
    renderPluginManagerModal();
  });

  installBtn.addEventListener('click', async () => {
    const url = modalContent.querySelector('#pluginUrlInput').value.trim();
    if (!url) { showToast('请输入 URL', 'warning'); return; }

    const statusEl = modalContent.querySelector('#pluginUrlStatus');
    installBtn.disabled = true;

    try {
      const { installFromUrl } = await import('../../plugins/pluginInstaller.js');
      const manifest = await installFromUrl(url, {
        onProgress: (p) => {
          statusEl.textContent = '阶段: ' + p.stage +
            (p.total > 0 ? ' (' + p.loaded + '/' + p.total + ')' : '');
        },
      });
      showToast('插件 "' + manifest.name + '" 安装成功', 'success');
      closeModal();
      renderPluginManagerModal();
    } catch (err) {
      showToast('安装失败: ' + err.message, 'error');
      statusEl.textContent = '❌ ' + err.message;
      installBtn.disabled = false;
    }
  });
}

// ============================================================
// 文件安装对话框
// ============================================================

function openFileInstallDialog() {
  const html = `
    <button class="modal-close">&times;</button>
    <h3 class="modal-title">从文件安装</h3>
    <div class="form-group">
      <label>选择插件包（.zip）</label>
      <div class="file-upload-wrapper">
        <input type="file" id="pluginFileInput" accept=".zip">
        <label class="file-upload-label" for="pluginFileInput">
          <i class="fas fa-cloud-upload-alt"></i>
          <span>选择文件</span>
          <span class="file-name" id="pluginFileName">未选择文件</span>
        </label>
      </div>
    </div>
    <div id="pluginFileStatus" style="margin: 0.5rem 0; font-size: 0.85rem; color: var(--color-text-muted); min-height: 1.2em;"></div>
    <div style="display: flex; gap: 0.5rem; justify-content: flex-end; margin-top: 1rem;">
      <button class="btn btn-secondary" id="pluginFileCancel">取消</button>
      <button class="btn btn-primary" id="pluginFileInstall">安装</button>
    </div>
  `;
  openModal(html);

  const modalContent = document.getElementById('modalContent');
  if (!modalContent) return;

  const fileInput = modalContent.querySelector('#pluginFileInput');
  const fileName = modalContent.querySelector('#pluginFileName');
  const cancelBtn = modalContent.querySelector('#pluginFileCancel');
  const installBtn = modalContent.querySelector('#pluginFileInstall');

  fileInput.addEventListener('change', (e) => {
    const f = e.target.files[0];
    fileName.textContent = f ? f.name : '未选择文件';
  });

  cancelBtn.addEventListener('click', () => {
    closeModal();
    renderPluginManagerModal();
  });

  installBtn.addEventListener('click', async () => {
    const file = fileInput.files[0];
    if (!file) { showToast('请选择文件', 'warning'); return; }

    const statusEl = modalContent.querySelector('#pluginFileStatus');
    installBtn.disabled = true;

    try {
      const { installFromFile } = await import('../../plugins/pluginInstaller.js');
      const manifest = await installFromFile(file, {
        onProgress: (p) => {
          statusEl.textContent = '阶段: ' + p.stage;
        },
      });
      showToast('插件 "' + manifest.name + '" 安装成功', 'success');
      closeModal();
      renderPluginManagerModal();
    } catch (err) {
      showToast('安装失败: ' + err.message, 'error');
      statusEl.textContent = '❌ ' + err.message;
      installBtn.disabled = false;
    }
  });
}

// ============================================================
// 详情对话框
// ============================================================

function showPluginDetail(plugin) {
  const escape = (s) => {
    const d = document.createElement('div');
    d.textContent = String(s == null ? '' : s);
    return d.innerHTML;
  };

  const perms = plugin.permissions || [];
  const permList = perms.length > 0
    ? perms.map(p => `
        <li style="margin: 0.2rem 0;">
          <code style="font-size: 0.8rem; color: var(--color-primary);">${escape(p)}</code>
          <span style="color: var(--color-text-secondary); margin-left: 0.4rem;">${escape(getPermissionLabel(p))}</span>
        </li>
      `).join('')
    : '<li style="color: var(--color-text-muted);">无</li>';

  const html = `
    <button class="modal-close">&times;</button>
    <h3 class="modal-title">${escape(plugin.name)}</h3>
    <div style="padding: 0.5rem 0;">
      <p style="color: var(--color-text-secondary);">${escape(plugin.description || '无描述')}</p>
      
      <div style="background: var(--color-bg-secondary); padding: 0.6rem 1rem; border-radius: var(--radius-sm); margin: 0.8rem 0; font-size: 0.85rem; line-height: 1.7;">
        <div><strong>ID:</strong> <code>${escape(plugin.id)}</code></div>
        <div><strong>版本:</strong> ${escape(plugin.version)}</div>
        <div><strong>作者:</strong> ${escape(plugin.author || '未知')}</div>
        <div><strong>状态:</strong> ${plugin.enabled ? '✅ 已启用' : '⚪ 未启用'}${plugin.running ? ' · 运行中' : ''}</div>
        <div><strong>来源:</strong> ${plugin.source === 'url' ? 'URL (' + escape(plugin.sourceUrl || 'N/A') + ')' : '本地文件'}</div>
        <div><strong>安装时间:</strong> ${new Date(plugin.installedAt).toLocaleString()}</div>
      </div>
      
      <strong style="font-size: 0.9rem;">权限清单 (${perms.length})</strong>
      <ul style="margin: 0.4rem 0 0 1.2rem; padding: 0; font-size: 0.85rem;">
        ${permList}
      </ul>
      
      <div style="display: flex; gap: 0.5rem; justify-content: flex-end; margin-top: 1rem;">
        <button class="btn btn-secondary" id="pluginDetailClose">关闭</button>
      </div>
    </div>
  `;
  openModal(html);

  const modalContent = document.getElementById('modalContent');
  if (modalContent) {
    const closeBtn = modalContent.querySelector('#pluginDetailClose');
    if (closeBtn) {
      closeBtn.addEventListener('click', () => {
        closeModal();
        renderPluginManagerModal();
      });
    }
  }
}