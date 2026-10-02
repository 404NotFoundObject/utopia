/**
 * @module ui/screens/settingsUI/sections/danger
 * @description 危险操作 section（使用指南 + 数据备份导出/导入 + 重置所有数据）
 *
 * 审计 C-8：备份原先「写得出、导不回」——
 *   1. 漏掉 lastMode / lastCharacterId / lastGroupId（这三个键不以 utopia 开头，被前缀过滤漏掉）
 *   2. 漏掉插件 VFS 库（插件记录、插件文件、插件 KV）
 *   3. 无版本头，无法校验备份文件是否可用
 *   4. 完全没有恢复路径
 * 现补齐上述四项：备份带版本头并覆盖插件库，同时提供导入恢复。
 */

import { deleteDatabase, getStores } from '../../../../core/db.js';
import {
  deleteVfsDatabase,
  getAllPlugins,
  getPluginFiles,
  savePlugin,
  kvGet,
  kvKeys,
  kvSet,
} from '../../../../plugins/pluginVfs.js';

export const BACKUP_FORMAT = 'utopia-backup';
export const BACKUP_VERSION = 1;

/** 不以 utopia 开头、但属于应用状态的 localStorage 键。备份与重置都必须覆盖。 */
const APP_STATE_KEYS = ['lastMode', 'lastCharacterId', 'lastGroupId'];

/** 已知需要清理的 localStorage 键（含历史遗留键名）。 */
const KNOWN_CLEANUP_KEYS = [
  'utopia_app_version',
  'utopia_db_version',
  'utopia-theme',
  'utopia:custom-themes',
  'utopia:dev-monitor',
  'utopia:wx-social-cover',
  'utopia:pending-call-end', // 审计 C-7：通话未正常结束的挂起标记，原先漏清理
];

// ============================================================
// 二进制编解码（插件文件可能是 ArrayBuffer，JSON 无法直接承载）
// ============================================================

function arrayBufferToBase64(buf) {
  const bytes = new Uint8Array(buf);
  let bin = '';
  const CHUNK = 0x8000; // 分块避免 apply 参数过多爆栈
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
  }
  return btoa(bin);
}

function base64ToArrayBuffer(b64) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes.buffer;
}

function encodeFileContent(content) {
  if (typeof content === 'string') return { t: 's', v: content };
  // 不能用 instanceof ArrayBuffer：IndexedDB 取回的对象可能来自不同 realm
  // （structured clone 的结果），instanceof 会误判为 false。用类型标签判定。
  const tag = Object.prototype.toString.call(content);
  if (tag === '[object ArrayBuffer]') return { t: 'b64', v: arrayBufferToBase64(content) };
  if (ArrayBuffer.isView(content)) {
    return { t: 'b64', v: arrayBufferToBase64(content.buffer ?? content) };
  }
  return { t: 'json', v: content };
}

function decodeFileContent(entry) {
  if (!entry || typeof entry !== 'object') return entry;
  switch (entry.t) {
    case 's': return entry.v;
    case 'b64': return base64ToArrayBuffer(entry.v);
    case 'json': return entry.v;
    default: return entry.v;
  }
}

// ============================================================
// 数据收集 / 恢复（与 UI 解耦，便于测试）
// ============================================================

/**
 * 收集完整备份数据。
 * @returns {Promise<Object>} 带版本头的备份对象。
 */
export async function collectBackupData() {
  const dump = {
    _format: BACKUP_FORMAT,
    _version: BACKUP_VERSION,
    _exportedAt: new Date().toISOString(),
    stores: {},
    localStorage: {},
    plugins: [],
  };

  // ---------- 主数据库 ----------
  const stores = await getStores();
  for (const [name, store] of Object.entries(stores)) {
    dump.stores[name] = await store.getAll();
  }

  // ---------- localStorage ----------
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key && key.startsWith('utopia')) dump.localStorage[key] = localStorage.getItem(key);
  }
  // 审计 C-8：这三个键不以 utopia 开头，前缀过滤取不到，必须显式补上
  for (const key of APP_STATE_KEYS) {
    const value = localStorage.getItem(key);
    if (value !== null) dump.localStorage[key] = value;
  }

  // ---------- 插件 VFS 库 ----------
  // 审计 C-8：原备份完全没有插件库，恢复后插件会全部丢失
  try {
    const pluginRecords = await getAllPlugins();
    for (const record of pluginRecords) {
      const files = await getPluginFiles(record.id);
      const encodedFiles = {};
      for (const [path, content] of Object.entries(files || {})) {
        encodedFiles[path] = encodeFileContent(content);
      }
      // 插件 KV 同样是插件状态的一部分，一并备份
      const kv = {};
      try {
        const keys = await kvKeys(record.id);
        for (const k of keys || []) kv[k] = await kvGet(record.id, k);
      } catch (e) {
        console.warn('[Backup] 插件 KV 读取失败:', record.id, e);
      }
      dump.plugins.push({ record, files: encodedFiles, kv });
    }
  } catch (err) {
    console.warn('[Backup] 插件库读取失败（备份将不含插件数据）:', err);
  }

  return dump;
}

/**
 * 校验备份文件是否为可恢复的格式。
 * @param {Object} dump
 * @throws {Error} 格式不符时抛出带明确原因的错误。
 */
export function validateBackup(dump) {
  if (!dump || typeof dump !== 'object') {
    throw new Error('文件内容不是有效的 JSON 对象');
  }
  if (dump._format !== BACKUP_FORMAT) {
    throw new Error('不是 Utopia 备份文件（缺少格式标识）。旧版备份不含版本头，无法安全恢复。');
  }
  if (dump._version !== BACKUP_VERSION) {
    throw new Error(`备份版本不兼容：文件为 v${dump._version}，当前支持 v${BACKUP_VERSION}`);
  }
  if (!dump.stores || typeof dump.stores !== 'object') {
    throw new Error('备份文件损坏：缺少 stores 字段');
  }
}

/**
 * 从备份数据恢复。采用「覆盖写」而非「先清空」——
 * 只覆盖备份中存在的记录，不删除当前库里多出来的数据，避免误删。
 *
 * @param {Object} dump - 经 validateBackup 校验的备份对象。
 * @returns {Promise<{stores: number, localStorage: number, plugins: number}>} 恢复统计。
 */
export async function restoreBackupData(dump) {
  validateBackup(dump);

  const stats = { stores: 0, localStorage: 0, plugins: 0 };

  // ---------- 主数据库 ----------
  const stores = await getStores();
  for (const [name, records] of Object.entries(dump.stores)) {
    const store = stores[name];
    if (!store) {
      console.warn('[Restore] 备份中有未知 store，已跳过:', name);
      continue;
    }
    for (const record of records || []) {
      // put 原样写回（update 会强制注入 id，对自增主键 store 会写坏主键）
      await store.put(record);
      stats.stores += 1;
    }
  }

  // ---------- localStorage ----------
  for (const [key, value] of Object.entries(dump.localStorage || {})) {
    if (value === null || value === undefined) continue;
    localStorage.setItem(key, String(value));
    stats.localStorage += 1;
  }

  // ---------- 插件 VFS 库 ----------
  for (const entry of dump.plugins || []) {
    try {
      const record = entry.record;
      if (!record || !record.manifest) continue;
      const files = {};
      for (const [path, encoded] of Object.entries(entry.files || {})) {
        files[path] = decodeFileContent(encoded);
      }
      await savePlugin(record.manifest, files, {
        enabled: record.enabled ?? false,
        installedAt: record.installedAt,
        source: record.source,
        sourceUrl: record.sourceUrl,
      });
      for (const [k, v] of Object.entries(entry.kv || {})) {
        await kvSet(record.id, k, v);
      }
      stats.plugins += 1;
    } catch (err) {
      console.warn('[Restore] 插件恢复失败:', entry?.record?.id, err);
    }
  }

  return stats;
}

// ============================================================
// UI
// ============================================================

export function renderDangerSection(settings, ctx) {
  return `
    <div style="display:flex;gap:0.5rem;margin:1rem 0;flex-wrap:wrap;">
      <button class="btn btn-sm" id="helpBtn">📖 使用指南</button>
      <button class="btn btn-sm" id="exportAllDataBtn">📦 导出数据备份</button>
      <button class="btn btn-sm" id="importBackupBtn">📥 导入数据备份</button>
      <input type="file" id="importBackupFile" accept="application/json,.json" hidden>
    </div>
    <div class="help-text" style="margin:-0.5rem 0 1rem;">
      备份包含角色、会话、记忆、世界书、插件与本地设置，可从备份文件完整恢复。
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

  // ---------- 导出备份 ----------
  const exportBtn = modalContent.querySelector('#exportAllDataBtn');
  if (exportBtn) {
    exportBtn.addEventListener('click', async () => {
      try {
        const dump = await collectBackupData();
        const blob = new Blob([JSON.stringify(dump, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `utopia-backup-${new Date().toISOString().slice(0, 10)}.json`;
        a.click();
        URL.revokeObjectURL(url);

        const pluginCount = dump.plugins?.length || 0;
        ctx.showToast(`✅ 备份已导出（含 ${pluginCount} 个插件）`, 'success');
      } catch (err) {
        console.error('[Settings/Danger] 导出失败:', err);
        ctx.showToast('❌ 导出失败: ' + err.message, 'error');
      }
    });
  }

  // ---------- 导入恢复（审计 C-8：原先完全没有恢复路径） ----------
  const importBtn = modalContent.querySelector('#importBackupBtn');
  const fileInput = modalContent.querySelector('#importBackupFile');
  if (importBtn && fileInput) {
    importBtn.addEventListener('click', () => fileInput.click());

    fileInput.addEventListener('change', async () => {
      const file = fileInput.files?.[0];
      fileInput.value = ''; // 允许连续选择同一个文件
      if (!file) return;

      if (!confirm('导入会用备份中的数据覆盖当前同名数据。\n\n确定继续吗？')) return;

      try {
        const text = await file.text();
        const dump = JSON.parse(text);
        const stats = await restoreBackupData(dump);
        ctx.showToast(
          `✅ 已恢复 ${stats.stores} 条记录 / ${stats.plugins} 个插件，页面即将刷新`,
          'success'
        );
        setTimeout(() => location.reload(), 1500);
      } catch (err) {
        console.error('[Settings/Danger] 导入失败:', err);
        alert('❌ 导入失败：' + err.message);
      }
    });
  }

  // ---------- 重置所有数据 ----------
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

      // ---------- localStorage 清理（审计 C-7） ----------
      // 先收集再删除：删除过程中 localStorage.length 会变化，边遍历边删会漏项
      const keysToRemove = new Set([...KNOWN_CLEANUP_KEYS, ...APP_STATE_KEYS]);
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && key.startsWith('utopia')) keysToRemove.add(key);
      }

      const removed = [];
      const failed = [];
      for (const key of keysToRemove) {
        try {
          localStorage.removeItem(key);
          // removeItem 没有返回值，必须读回验证——否则「清理成功」永远是假报告
          if (localStorage.getItem(key) === null) removed.push(key);
          else failed.push(key);
        } catch (err) {
          failed.push(key);
          console.warn('[Settings/Danger] 键清理失败:', key, err);
        }
      }

      if (failed.length > 0) {
        anyFailure = true;
        results.push(`本地缓存：⚠️ 已清理 ${removed.length} 项，${failed.length} 项残留（${failed.join('、')}）`);
      } else {
        results.push(`本地缓存：✅ 已清理 ${removed.length} 项`);
      }

      if (anyFailure) {
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
