/**
 * @module plugins/pluginInstaller
 * @description 插件安装器 - 从 URL 或本地文件安装 zip 包
 *
 * 依赖：fflate（ZIP 解压）
 * 流程：下载 → 解压 → 校验 → 权限确认 → 写入 VFS
 *
 */

import { unzipSync, strFromU8 } from 'fflate';
import { savePlugin, getPlugin, deletePlugin } from './pluginVfs.js';
import { validateManifest } from './pluginValidator.js';
import { showToast } from '../ui/components/toast.js';
import { openModal, closeModal } from '../ui/components/modal.js';
import { getPermissionLabel } from './permissionChecker.js';

// ============================================================
// 安装入口
// ============================================================

/**
 * 从 URL 安装
 */
export async function installFromUrl(url, opts = {}) {
  const onProgress = opts.onProgress;
  const autoEnable = !!opts.autoEnable;

  if (onProgress) onProgress({ stage: 'downloading', loaded: 0, total: 0 });

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error('下载失败: HTTP ' + response.status);
  }

  const buffer = await response.arrayBuffer();

  if (onProgress) {
    onProgress({ stage: 'downloaded', loaded: buffer.byteLength, total: buffer.byteLength });
  }

  return installFromZipData(new Uint8Array(buffer), {
    source: 'url',
    sourceUrl: url,
    autoEnable,
    onProgress,
  });
}

/**
 * 从本地 File 安装
 */
export async function installFromFile(file, opts = {}) {
  const autoEnable = !!opts.autoEnable;
  const onProgress = opts.onProgress;

  if (!file || !file.name.toLowerCase().endsWith('.zip')) {
    throw new Error('请选择 .zip 格式的插件包');
  }

  if (onProgress) onProgress({ stage: 'reading', loaded: 0, total: file.size });

  const buffer = await file.arrayBuffer();

  if (onProgress) {
    onProgress({ stage: 'read', loaded: buffer.byteLength, total: buffer.byteLength });
  }

  return installFromZipData(new Uint8Array(buffer), {
    source: 'local',
    sourceUrl: null,
    autoEnable,
    onProgress,
  });
}

/**
 * 核心安装逻辑
 */
export async function installFromZipData(zipData, opts = {}) {
  const source = opts.source || 'unknown';
  const sourceUrl = opts.sourceUrl || null;
  const autoEnable = !!opts.autoEnable;
  const onProgress = opts.onProgress || function () {};

  // ---- 1. 解压 ----
  onProgress({ stage: 'unzipping', loaded: 0, total: 0 });

  let unzipped;
  try {
    unzipped = unzipSync(zipData);
  } catch (err) {
    throw new Error('ZIP 解压失败: ' + err.message);
  }

  // ---- 2. 过滤垃圾文件 ----
  const rawFiles = {};
  for (const path of Object.keys(unzipped)) {
    if (path.endsWith('/')) continue;                    // 目录
    if (path.startsWith('__MACOSX/')) continue;          // Mac 资源
    if (path.endsWith('.DS_Store')) continue;            // Mac 垃圾
    if (path.startsWith('._')) continue;                 // Mac 临时文件
    rawFiles[path] = unzipped[path];
  }

  // ---- 3. 处理可能的顶层包裹目录 ----
  let manifestPath = 'manifest.json';
  let prefix = '';

  if (!rawFiles['manifest.json']) {
    // 查找所有以 manifest.json 结尾的文件
    const candidates = Object.keys(rawFiles).filter(
      p => p.endsWith('manifest.json') && p.split('/').length === 2
    );
    if (candidates.length > 0) {
      manifestPath = candidates[0];
      prefix = manifestPath.slice(0, -'manifest.json'.length);
    }
  }

  // ---- 4. 重新组织文件路径 ----
  const files = {};
  for (const [path, content] of Object.entries(rawFiles)) {
    const newPath = prefix && path.startsWith(prefix) ? path.slice(prefix.length) : path;
    if (newPath) files[newPath] = content;
  }

  if (!files['manifest.json']) {
    throw new Error('插件包中缺少 manifest.json');
  }

  // ---- 5. 解析并校验清单 ----
  let manifest;
  try {
    manifest = JSON.parse(strFromU8(files['manifest.json']));
  } catch (err) {
    throw new Error('manifest.json 解析失败: ' + err.message);
  }

  validateManifest(manifest);

  // ---- 6. 检查入口文件 ----
  if (!files[manifest.main]) {
    throw new Error('入口文件不存在: ' + manifest.main);
  }
  if (manifest.ui && !files[manifest.ui]) {
    throw new Error('UI 文件不存在: ' + manifest.ui);
  }

  // ---- 7. 检查是否已安装 ----
  const existing = await getPlugin(manifest.id);
  if (existing) {
    throw new Error(
      '插件 "' + manifest.id + '" 已安装（v' + existing.manifest.version + '），请先卸载'
    );
  }

  // ---- 8. 权限确认 ----
  onProgress({ stage: 'permission', loaded: 0, total: 0 });
  const confirmed = await showPermissionDialog(manifest);
  if (!confirmed) {
    throw new Error('用户取消了安装');
  }

  // ---- 9. 写入 VFS ----
  onProgress({ stage: 'saving', loaded: 0, total: 0 });
  await savePlugin(manifest, files, {
    source,
    sourceUrl,
    enabled: autoEnable,
  });

  onProgress({ stage: 'done', loaded: 0, total: 0 });

  console.log('[PluginInstaller] ✅ 插件已安装: ' + manifest.name);
  return manifest;
}

// ============================================================
// 权限确认对话框
// ============================================================

/**
 * 显示权限确认对话框
 *
 *
 * @param {Object} manifest
 * @returns {Promise<boolean>} true = 用户确认安装，false = 用户取消
 */
function showPermissionDialog(manifest) {
  return new Promise((resolve) => {
    // ---- 结果保护：防止重复 resolve ----
    let settled = false;
    const safeResolve = (value) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };

    // ---- 用户意图：区分"确认"与"取消/关闭" ----
    // 默认 false（视为取消），只有点击"确认安装"才置为 true
    let userChoice = false;

    // ---- 构建权限列表 HTML ----
    const permissionList = manifest.permissions || [];
    const hasWildcard = permissionList.includes('*');

    let itemsHtml;
    if (permissionList.length === 0) {
      itemsHtml = '<li style="color:var(--color-text-muted);">无需任何权限</li>';
    } else {
      itemsHtml = permissionList.map(function (p) {
        const label = getPermissionLabel(p);
        const isDangerous = p === '*' || p.endsWith(':write');
        const color = isDangerous ? 'var(--color-danger)' : 'var(--color-text-secondary)';
        return '<li style="color:' + color + '; margin: 0.3rem 0;">' +
          label +
          ' <code style="font-size:0.75rem;color:var(--color-text-muted);">' + p + '</code>' +
          '</li>';
      }).join('');
    }

    const html = '' +
      '<button class="modal-close">&times;</button>' +
      '<h2 class="modal-title">🔌 安装插件</h2>' +
      '<div style="padding: 0.5rem 0;">' +
        '<div style="background: var(--color-bg-secondary); padding: 1rem; border-radius: var(--radius-md); margin-bottom: 1rem;">' +
          '<h3 style="margin: 0 0 0.5rem 0; font-size: 1.1rem;">' + escapeHtml(manifest.name) + '</h3>' +
          '<p style="margin: 0.2rem 0; color: var(--color-text-secondary); font-size: 0.9rem;">' +
            escapeHtml(manifest.description || '无描述') +
          '</p>' +
          '<p style="margin: 0.2rem 0; color: var(--color-text-muted); font-size: 0.85rem;">' +
            '版本 ' + escapeHtml(manifest.version) + ' · ' + escapeHtml(manifest.author || '未知作者') +
          '</p>' +
        '</div>' +
        '<div style="margin-bottom: 1rem;">' +
          '<strong style="font-size: 0.95rem;">此插件请求以下权限：</strong>' +
          '<ul style="margin: 0.5rem 0 0 1.2rem; padding: 0; font-size: 0.9rem; line-height: 1.8;">' +
            itemsHtml +
          '</ul>' +
        '</div>' +
        (hasWildcard
          ? '<div style="background: rgba(225, 112, 85, 0.1); border-left: 3px solid var(--color-danger); padding: 0.6rem 1rem; border-radius: 4px; margin-bottom: 1rem; font-size: 0.85rem;">' +
              '⚠️ <strong>此插件请求完全访问权限</strong>，请确保你信任该插件来源。' +
            '</div>'
          : '') +
        '<p style="font-size: 0.8rem; color: var(--color-text-muted); margin-bottom: 1rem;">' +
          '💡 插件运行在隔离环境中，但请谨慎安装来源不明的插件。' +
        '</p>' +
        '<div style="display: flex; gap: 0.5rem; justify-content: flex-end;">' +
          '<button class="btn btn-secondary" id="pluginInstallCancel">取消</button>' +
          '<button class="btn btn-primary" id="pluginInstallConfirm">确认安装</button>' +
        '</div>' +
      '</div>';

    // ---- 打开模态框（含降级路径） ----
    try {
      //   X 按钮 / 遮罩点击 / 两个操作按钮 关闭时都会触发此回调
      openModal(html, () => {
        safeResolve(userChoice);
      });
    } catch (err) {
      // 模态框组件加载失败，降级到原生 confirm
      const msg = '安装插件 "' + manifest.name + '"？\n\n请求权限：\n' +
        permissionList.map(p => '· ' + getPermissionLabel(p)).join('\n');
      safeResolve(confirm(msg));
      return;
    }

    const modalContent = document.getElementById('modalContent');
    if (!modalContent) {
      // 模态框内容节点缺失，视为取消
      // 注：此时 openModal 已被调用，需要主动 closeModal 触发 onClose，
      //     否则 _onCloseCallback 会残留到下一次 openModal 时被误触发
      safeResolve(false);
      try { closeModal(); } catch (_) {}
      return;
    }

    // ---- 绑定操作按钮 ----
    // 注意：不直接 resolve，只设置 userChoice 并 closeModal，
    //       由 onClose 统一 resolve。这样三种关闭路径行为一致。
    const cancelBtn = modalContent.querySelector('#pluginInstallCancel');
    const confirmBtn = modalContent.querySelector('#pluginInstallConfirm');

    if (cancelBtn) {
      cancelBtn.addEventListener('click', () => {
        userChoice = false;
        closeModal();  // → 触发 onClose → safeResolve(false)
      });
    }

    if (confirmBtn) {
      confirmBtn.addEventListener('click', () => {
        userChoice = true;
        closeModal();  // → 触发 onClose → safeResolve(true)
      });
    }
  });
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = String(text == null ? '' : text);
  return div.innerHTML;
}

// ============================================================
// 卸载
// ============================================================

/**
 * 卸载插件
 */
export async function uninstallPlugin(pluginId, opts = {}) {
  const skipConfirm = !!opts.skipConfirm;

  if (!skipConfirm) {
    const confirmed = confirm(
      '确定要卸载插件 "' + pluginId + '" 吗？\n\n' +
      '卸载后，该插件注册的钩子、UI 元素、命令都将被移除。'
    );
    if (!confirmed) return false;
  }

  // 先停用
  try {
    const { disablePlugin } = await import('./pluginManager.js');
    await disablePlugin(pluginId, { silent: true });
  } catch (err) {
    console.warn('[PluginInstaller] 停用插件失败（可能未启用）:', err);
  }

  // 从 VFS 删除
  await deletePlugin(pluginId);

  showToast('插件已卸载', 'success');
  console.log('[PluginInstaller] 🗑️ 已卸载: ' + pluginId);

  return true;
}