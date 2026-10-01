/**
 * Schema 失配的自愈与检测。
 *
 * 前提：同源下可能存在「版本号与 DB_VERSION 相同但 schema 不同」的库
 * （更早的构建、或同端口下跑过的其他版本）。这种情况下 onupgradeneeded
 * 不会触发，ensureSchema 也不会执行，因此必须由 openDB 主动探测并处置。
 *
 * 本文件覆盖三类场景：
 *   1. 仅缺表/缺索引 —— 应当自动补全（自适应修复，无数据损失）
 *   2. keyPath 不一致（空库/字段缺失）—— 无法无损修复，抛出明确错误交由上层提示用户重建
 *   3. keyPath 不一致（有数据且字段齐全）—— 记录级迁移，读出旧数据重建主键后写回
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { openDB, getStores, deleteDatabase } from '../../js/core/db.js';

const DB_NAME = 'UtopiaDB';
const EXPECTED_STORE_COUNT = 11;

/**
 * 人为造一个 schema 不完整的旧库。
 * @param {Object} storeDefs 形如 { characters: { keyPath: 'id' }, ... }
 * @param {number} version
 */
function seedLegacyDb(storeDefs, version = 9) {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, version);
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const [name, opts] of Object.entries(storeDefs)) {
        db.createObjectStore(name, opts);
      }
    };
    req.onsuccess = () => {
      req.result.close();
      resolve();
    };
    req.onerror = () => reject(req.error);
  });
}

function storeNames(db) {
  return Array.from(db.objectStoreNames);
}

describe('core/db · schema 失配处理', () => {
  beforeEach(async () => {
    await deleteDatabase();
  });

  describe('仅缺表（keyPath 全部正确）', () => {
    it('自动补全缺失的 store，无需用户干预', async () => {
      // 模拟一个只有 3 张表的 v9 旧库
      await seedLegacyDb({
        characters: { keyPath: 'id' },
        settings: { keyPath: 'id' },
        memories: { keyPath: 'id' },
      });

      const db = await openDB();
      const names = storeNames(db);

      expect(names).toContain('conversations');
      expect(names).toContain('time_state');
      expect(names).toContain('posts');
      expect(names).toContain('world_book');
      expect(names).toContain('groups');
      expect(names).toContain('group_members');
      expect(names).toContain('group_messages');
      expect(names).toContain('rule_groups');
      expect(names).toHaveLength(EXPECTED_STORE_COUNT);
      db.close();
    });

    it('自愈后保留旧库中已有的数据', async () => {
      await seedLegacyDb({
        characters: { keyPath: 'id' },
        settings: { keyPath: 'id' },
        memories: { keyPath: 'id' },
      });

      // 先写入一条旧数据
      await new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, 9);
        req.onsuccess = () => {
          const db = req.result;
          const tx = db.transaction('characters', 'readwrite');
          tx.objectStore('characters').add({ id: 'legacy-1', name: '旧角色', createdAt: 1 });
          tx.oncomplete = () => { db.close(); resolve(); };
          tx.onerror = () => reject(tx.error);
        };
        req.onerror = () => reject(req.error);
      });

      const db = await openDB();
      db.close();

      const { characters } = await getStores();
      const kept = await characters.get('legacy-1');
      expect(kept).toBeDefined();
      expect(kept.name).toBe('旧角色');
    });

    it('缺索引的旧库也会被补全', async () => {
      await seedLegacyDb({
        characters: { keyPath: 'id' },   // 缺少 name / createdAt 索引
        settings: { keyPath: 'id' },
        memories: { keyPath: 'id' },
      });

      const db = await openDB();
      const tx = db.transaction('characters', 'readonly');
      const indexNames = Array.from(tx.objectStore('characters').indexNames);
      expect(indexNames).toContain('name');
      expect(indexNames).toContain('createdAt');
      db.close();
    });

    it('schema 正常时不做任何多余动作', async () => {
      const first = await openDB();
      const firstVersion = first.version;
      first.close();

      const second = await openDB();
      // 版本不应因为「校验」而被无谓抬高
      expect(second.version).toBe(firstVersion);
      expect(storeNames(second)).toHaveLength(EXPECTED_STORE_COUNT);
      second.close();
    });

    it('自愈后可正常读写（settings 主键可命中）', async () => {
      await seedLegacyDb({
        characters: { keyPath: 'id' },
        settings: { keyPath: 'id' },
        memories: { keyPath: 'id' },
      });

      const db = await openDB();
      db.close();

      const { settings } = await getStores();
      await expect(
        settings.add({ id: 'app_settings', apiProvider: 'openai' }),
      ).resolves.toBeDefined();
      expect((await settings.get('app_settings')).apiProvider).toBe('openai');
    });
  });

  describe('keyPath 不一致（无法无损修复）', () => {
    it('抛出明确错误而不是带着坏库继续运行', async () => {
      // settings 的主键路径与当前代码不符 —— 这正是仓库里 DataError 的成因
      await seedLegacyDb({
        characters: { keyPath: 'id' },
        settings: { keyPath: 'key' },
        memories: { keyPath: 'id' },
      });

      await expect(openDB()).rejects.toThrow(/schema|主键|keyPath/i);
    });

    it('错误信息中指出具体是哪张表有问题', async () => {
      await seedLegacyDb({
        characters: { keyPath: 'id' },
        settings: { keyPath: 'key' },
        memories: { keyPath: 'id' },
      });

      await expect(openDB()).rejects.toThrow(/settings/);
    });

    it('不含 keyPath 的旧库（外置主键）同样被识别', async () => {
      await seedLegacyDb({
        characters: { keyPath: 'id' },
        settings: {},                    // 外置主键
        memories: { keyPath: 'id' },
      });

      await expect(openDB()).rejects.toThrow(/settings/);
    });
  });

  describe('keyPath 不一致但有数据（记录级迁移）', () => {
    it('有数据且字段齐全时，无损迁移到新主键', async () => {
      // settings 旧库用错误 keyPath 'key'，且已有一条记录 { id: 'app_settings', ... }
      await seedLegacyDb({
        characters: { keyPath: 'id' },
        settings: { keyPath: 'key' },
        memories: { keyPath: 'id' },
      });
      await new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, 9);
        req.onsuccess = () => {
          const db = req.result;
          const tx = db.transaction('settings', 'readwrite');
          tx.objectStore('settings').add({ id: 'app_settings', key: 'app_settings', apiProvider: 'openai' });
          tx.oncomplete = () => { db.close(); resolve(); };
          tx.onerror = () => reject(tx.error);
        };
        req.onerror = () => reject(req.error);
      });

      const db = await openDB();
      db.close();

      const { settings } = await getStores();
      const kept = await settings.get('app_settings');
      expect(kept).toBeDefined();
      expect(kept.apiProvider).toBe('openai');
    });

    it('记录缺少新 keyPath 字段时，不迁移并报错', async () => {
      await seedLegacyDb({
        characters: { keyPath: 'id' },
        settings: { keyPath: 'key' },
        memories: { keyPath: 'id' },
      });
      // 记录里没有 id 字段（只有 key），无法映射到新主键
      await new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, 9);
        req.onsuccess = () => {
          const db = req.result;
          const tx = db.transaction('settings', 'readwrite');
          tx.objectStore('settings').add({ key: 'some_key', apiProvider: 'openai' });
          tx.oncomplete = () => { db.close(); resolve(); };
          tx.onerror = () => reject(tx.error);
        };
        req.onerror = () => reject(req.error);
      });

      await expect(openDB()).rejects.toThrow(/settings/);
    });
  });
});
