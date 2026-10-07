/**
 * js/ui/screens/settingsUI/sections/dangerSection 单元测试：备份与恢复。
 *
 * 覆盖四个子问题：① 漏无前缀的 localStorage 键 ② 漏插件 VFS 库
 * ③ 无版本头（无法校验）④ 无恢复路径
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  collectBackupData,
  restoreBackupData,
  validateBackup,
  BACKUP_FORMAT,
  BACKUP_VERSION,
} from '../../../js/ui/screens/settingsUI/sections/dangerSection.js';
import {
  savePlugin,
  getPlugin,
  getPluginFiles,
  deleteVfsDatabase,
} from '../../../js/plugins/pluginVfs.js';

describe('ui/dangerSection · 备份与恢复', () => {
  beforeEach(async () => {
    localStorage.clear();
    await deleteVfsDatabase();
  });

  afterEach(async () => {
    localStorage.clear();
    await deleteVfsDatabase();
  });

  // ---- ③ 版本头 ----

  it('备份带格式与版本头', async () => {
    const dump = await collectBackupData();
    expect(dump._format).toBe(BACKUP_FORMAT);
    expect(dump._version).toBe(BACKUP_VERSION);
    expect(dump._exportedAt).toBeDefined();
    expect(typeof dump.stores).toBe('object');
  });

  it('拒绝非 Utopia 备份文件（旧版无版本头）', () => {
    expect(() => validateBackup({ characters: [] })).toThrow(/不是 Utopia 备份文件/);
  });

  it('拒绝版本不兼容的备份文件', () => {
    expect(() =>
      validateBackup({ _format: BACKUP_FORMAT, _version: 999, stores: {} })
    ).toThrow(/版本不兼容/);
  });

  it('拒绝损坏（缺 stores）的备份文件', () => {
    expect(() =>
      validateBackup({ _format: BACKUP_FORMAT, _version: BACKUP_VERSION })
    ).toThrow(/缺少 stores/);
  });

  // ---- ① 无前缀的 localStorage 键 ----

  it('备份包含不以 utopia 开头的应用状态键', async () => {
    localStorage.setItem('lastMode', 'chat');
    localStorage.setItem('lastCharacterId', 'char-1');
    localStorage.setItem('lastGroupId', 'group-1');

    const dump = await collectBackupData();

    expect(dump.localStorage.lastMode).toBe('chat');
    expect(dump.localStorage.lastCharacterId).toBe('char-1');
    expect(dump.localStorage.lastGroupId).toBe('group-1');
  });

  it('备份同时保留 utopia 前缀键', async () => {
    localStorage.setItem('utopia-theme', 'wechat');
    const dump = await collectBackupData();
    expect(dump.localStorage['utopia-theme']).toBe('wechat');
  });

  // ---- ② 插件 VFS 库 ----

  it('备份包含插件记录与文件', async () => {
    await savePlugin(
      { id: 'demo-plugin', name: '演示插件' },
      { 'index.js': 'console.log("hi")' },
      { enabled: true }
    );

    const dump = await collectBackupData();

    expect(dump.plugins).toHaveLength(1);
    expect(dump.plugins[0].record.id).toBe('demo-plugin');
    expect(dump.plugins[0].files['index.js']).toBeDefined();
  });

  it('二进制插件文件可正确编码进备份', async () => {
    const bytes = new Uint8Array([1, 2, 3, 250]);
    await savePlugin({ id: 'bin-plugin', name: '二进制插件' }, { 'data.bin': bytes.buffer }, {});

    const dump = await collectBackupData();
    const encoded = dump.plugins[0].files['data.bin'];

    // JSON 无法直接承载 ArrayBuffer，必须编码为 base64 信封
    expect(encoded.t).toBe('b64');
    expect(typeof encoded.v).toBe('string');
  });

  // ---- ④ 恢复路径 ----

  it('恢复可还原 localStorage 与插件', async () => {
    await savePlugin(
      { id: 'p-restore', name: '待恢复插件' },
      { 'main.js': 'export default {}' },
      { enabled: true }
    );
    localStorage.setItem('lastMode', 'group');
    const dump = await collectBackupData();

    // 清空后恢复
    localStorage.removeItem('lastMode');
    await deleteVfsDatabase();
    expect(localStorage.getItem('lastMode')).toBeNull();

    const stats = await restoreBackupData(dump);

    expect(stats.plugins).toBe(1);
    expect(localStorage.getItem('lastMode')).toBe('group');
    const restored = await getPlugin('p-restore');
    expect(restored).toBeDefined();
    // record 结构是 { id, manifest, ... }，名称在 manifest 里
    expect(restored.manifest.name).toBe('待恢复插件');
  });

  it('二进制插件文件恢复后内容一致', async () => {
    const bytes = new Uint8Array([1, 2, 3, 250]);
    await savePlugin({ id: 'p-bin', name: '二进制' }, { 'data.bin': bytes.buffer }, {});
    const dump = await collectBackupData();

    await deleteVfsDatabase();
    await restoreBackupData(dump);

    const files = await getPluginFiles('p-bin');
    expect(Array.from(new Uint8Array(files['data.bin']))).toEqual([1, 2, 3, 250]);
  });

  it('恢复返回各分区的写入条数', async () => {
    localStorage.setItem('utopia-theme', 'wechat');
    const dump = await collectBackupData();
    localStorage.clear();

    const stats = await restoreBackupData(dump);

    expect(stats.localStorage).toBeGreaterThanOrEqual(1);
    expect(typeof stats.stores).toBe('number');
    expect(typeof stats.plugins).toBe('number');
  });
});
