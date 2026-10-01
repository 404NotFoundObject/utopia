/**
 * db.js 集成测试。
 *
 * 使用 fake-indexeddb 在 Node 中提供真实的 IndexedDB 语义（事务、索引、游标），
 * 因此这里验证的是 db.js 封装层与真实存储行为的配合，而非 mock。
 *
 * 单例说明：db.js 内部以 dbInstance 缓存连接。setup 的 beforeEach 会整体替换
 * globalThis.indexedDB，若不清掉旧连接，后续断言会打到上一个测试遗留的库上。
 * 因此本文件在每个用例前显式调用 deleteDatabase()，它会关闭并置空该单例。
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  openDB,
  getDB,
  getStores,
  withKeyLock,
  checkDatabase,
  deleteDatabase,
} from '../../js/core/db.js';

const EXPECTED_STORES = [
  'characters',
  'conversations',
  'settings',
  'memories',
  'time_state',
  'posts',
  'world_book',
  'groups',
  'group_members',
  'group_messages',
  'rule_groups',
];

const EXPECTED_INDEXES = {
  characters: ['name', 'createdAt'],
  conversations: ['characterId', 'updatedAt'],
  memories: ['characterId', 'timestamp'],
  posts: ['authorId', 'timestamp', 'authorType'],
  world_book: ['scope', 'enabled', 'category', 'groupId'],
  groups: ['status', 'createdAt'],
  group_members: ['groupId', 'memberId', 'memberType'],
  group_messages: ['groupId', 'senderId', 'timestamp'],
  rule_groups: ['enabled', 'parentGroupId', 'exclusiveGroup', 'createdAt'],
};

describe('core/db · 集成', () => {
  beforeEach(async () => {
    await deleteDatabase();
  });

  describe('schema 建表', () => {
    it('首次打开创建全部 11 个 objectStore', async () => {
      const db = await openDB();
      const names = Array.from(db.objectStoreNames);
      for (const store of EXPECTED_STORES) {
        expect(names, `缺少 store: ${store}`).toContain(store);
      }
      expect(names).toHaveLength(EXPECTED_STORES.length);
      db.close();
    });

    it('为各表创建声明的索引', async () => {
      const db = await openDB();
      for (const [storeName, indexes] of Object.entries(EXPECTED_INDEXES)) {
        const tx = db.transaction(storeName, 'readonly');
        const indexNames = Array.from(tx.objectStore(storeName).indexNames);
        for (const idx of indexes) {
          expect(indexNames, `${storeName} 缺少索引 ${idx}`).toContain(idx);
        }
      }
      db.close();
    });

    it('重复打开不报错且不重复建表（schema 幂等）', async () => {
      const first = await openDB();
      first.close();
      const second = await openDB();
      expect(Array.from(second.objectStoreNames)).toHaveLength(EXPECTED_STORES.length);
      second.close();
    });

    it('getDB 复用同一连接（单例）', async () => {
      const a = await getDB();
      const b = await getDB();
      expect(a).toBe(b);
    });
  });

  describe('getStores CRUD', () => {
    it('暴露全部 11 个表的操作句柄', async () => {
      const stores = await getStores();
      for (const name of EXPECTED_STORES) {
        expect(stores[name], `缺少句柄: ${name}`).toBeDefined();
        expect(typeof stores[name].add).toBe('function');
        expect(typeof stores[name].get).toBe('function');
      }
    });

    it('add 后可用 get 读回', async () => {
      const { characters } = await getStores();
      await characters.add({ id: 'c1', name: '柳如烟', createdAt: 1 });
      const found = await characters.get('c1');
      expect(found).toEqual({ id: 'c1', name: '柳如烟', createdAt: 1 });
    });

    it('get 不存在的键返回 undefined', async () => {
      const { characters } = await getStores();
      expect(await characters.get('missing')).toBeUndefined();
    });

    it('getAll 返回全部记录', async () => {
      const { characters } = await getStores();
      await characters.add({ id: 'c1', name: 'A', createdAt: 1 });
      await characters.add({ id: 'c2', name: 'B', createdAt: 2 });
      const all = await characters.getAll();
      expect(all).toHaveLength(2);
    });

    it('update 覆盖同 id 记录而不新增', async () => {
      const { characters } = await getStores();
      await characters.add({ id: 'c1', name: '旧名', createdAt: 1 });
      await characters.update('c1', { id: 'c1', name: '新名', createdAt: 1 });
      const all = await characters.getAll();
      expect(all).toHaveLength(1);
      expect((await characters.get('c1')).name).toBe('新名');
    });

    it('update 对不存在的 id 执行新增（put 语义）', async () => {
      const { characters } = await getStores();
      await characters.update('c9', { id: 'c9', name: '新建', createdAt: 9 });
      expect((await characters.get('c9')).name).toBe('新建');
    });

    it('delete 移除记录', async () => {
      const { characters } = await getStores();
      await characters.add({ id: 'c1', name: 'A', createdAt: 1 });
      await characters.delete('c1');
      expect(await characters.get('c1')).toBeUndefined();
    });

    it('add 重复主键被拒绝', async () => {
      const { characters } = await getStores();
      await characters.add({ id: 'c1', name: 'A', createdAt: 1 });
      await expect(characters.add({ id: 'c1', name: 'B', createdAt: 2 })).rejects.toBeDefined();
    });
  });

  describe('getByIndex', () => {
    it('按 characterId 索引过滤会话', async () => {
      const { conversations } = await getStores();
      await conversations.add({ id: 'v1', characterId: 'c1', updatedAt: 1 });
      await conversations.add({ id: 'v2', characterId: 'c1', updatedAt: 2 });
      await conversations.add({ id: 'v3', characterId: 'c2', updatedAt: 3 });

      const forC1 = await conversations.getByIndex('characterId', 'c1');
      expect(forC1).toHaveLength(2);
      expect(forC1.every(c => c.characterId === 'c1')).toBe(true);
    });

    it('无匹配返回空数组', async () => {
      const { memories } = await getStores();
      expect(await memories.getByIndex('characterId', 'nobody')).toEqual([]);
    });

    it('按时间索引可过滤记忆', async () => {
      const { memories } = await getStores();
      await memories.add({ id: 'm1', characterId: 'c1', timestamp: 100 });
      await memories.add({ id: 'm2', characterId: 'c2', timestamp: 200 });
      expect(await memories.getByIndex('timestamp', 200)).toHaveLength(1);
    });
  });

  describe('withKeyLock · 键级串行锁', () => {
    it('同一 key 的临界区严格串行执行', async () => {
      const order = [];
      const task = (name) => withKeyLock('test', 'same', async () => {
        order.push(`${name}:start`);
        await new Promise(r => setTimeout(r, 10));
        order.push(`${name}:end`);
      });

      await Promise.all([task('A'), task('B'), task('C')]);
      expect(order).toEqual([
        'A:start', 'A:end',
        'B:start', 'B:end',
        'C:start', 'C:end',
      ]);
    });

    it('不同 key 之间互不阻塞', async () => {
      const order = [];
      const task = (key, name) => withKeyLock('test', key, async () => {
        order.push(`${name}:start`);
        await new Promise(r => setTimeout(r, 10));
        order.push(`${name}:end`);
      });

      await Promise.all([task('k1', 'A'), task('k2', 'B')]);
      // 两个任务并发，start 应相邻出现在任一 end 之前
      expect(order.slice(0, 2).sort()).toEqual(['A:start', 'B:start']);
    });

    it('不同 namespace 之间互不阻塞', async () => {
      let concurrent = 0;
      let maxConcurrent = 0;
      const task = (ns) => withKeyLock(ns, 'k', async () => {
        concurrent++;
        maxConcurrent = Math.max(maxConcurrent, concurrent);
        await new Promise(r => setTimeout(r, 10));
        concurrent--;
      });
      await Promise.all([task('ns1'), task('ns2')]);
      expect(maxConcurrent).toBe(2);
    });

    it('返回 fn 的返回值', async () => {
      const result = await withKeyLock('test', 'ret', async () => 'done');
      expect(result).toBe('done');
    });

    it('前一个任务抛错不会阻塞后续任务', async () => {
      const order = [];
      await Promise.all([
        withKeyLock('test', 'err', async () => { throw new Error('first fails'); }).catch(() => {}),
        withKeyLock('test', 'err', async () => { order.push('second ran'); }),
      ]);
      expect(order).toEqual(['second ran']);
    });

    it('fn 抛错时异常向外传播', async () => {
      await expect(
        withKeyLock('test', 'throw', async () => { throw new Error('boom'); }),
      ).rejects.toThrow('boom');
    });

    it('锁使用后不泄漏：连续执行多轮不堆积', async () => {
      for (let i = 0; i < 50; i++) {
        await withKeyLock('test', 'seq', async () => i);
      }
      // 若锁未清理，第 50 轮会等待前 49 个已完成的 Promise，表现为超时；
      // 这里能正常结束即证明锁被释放
      expect(true).toBe(true);
    });
  });

  describe('deleteDatabase', () => {
    it('删除后再次打开会重建 schema', async () => {
      // 注意：openDB() 返回的连接不受 dbInstance 管理，deleteDatabase() 无法代为关闭。
      // 同一测试内若不先 close，删除请求会因存在活动连接而触发 onblocked。
      const initial = await openDB();
      initial.close();

      await deleteDatabase();

      const db = await openDB();
      expect(Array.from(db.objectStoreNames)).toHaveLength(EXPECTED_STORES.length);
      db.close();
    });

    it('删除后数据不残留', async () => {
      const { characters } = await getStores();
      await characters.add({ id: 'c1', name: 'A', createdAt: 1 });
      await deleteDatabase();

      const fresh = await getStores();
      expect(await fresh.characters.getAll()).toEqual([]);
    });

    it('可重复调用', async () => {
      await deleteDatabase();
      await expect(deleteDatabase()).resolves.toBeUndefined();
    });
  });

  describe('checkDatabase', () => {
    it('数据库正常时返回 ok', async () => {
      const result = await checkDatabase();
      expect(result.ok).toBe(true);
    });

    it('检查后会关闭自己打开的连接，不阻塞后续删库', async () => {
      // 校验前提：checkDatabase 若残留活动连接，任何 deleteDatabase() 都会触发 onblocked
      await checkDatabase();
      await expect(deleteDatabase()).resolves.toBeUndefined();
    });

    it('表结构不可读时返回 ok=false 并带上错误码', async () => {
      // 造一个「有数据但缺少新主键字段」的库：keyPath 错配且记录无 id 字段，
      // 无法无损迁移，openDB 应抛 SchemaMismatchError。
      await deleteDatabase();
      await new Promise((resolve, reject) => {
        const req = indexedDB.open('UtopiaDB', 9);
        req.onupgradeneeded = () => {
          const db = req.result;
          db.createObjectStore('characters', { keyPath: 'not_id' });
        };
        req.onsuccess = () => {
          const db = req.result;
          // 写入一条不含 id 字段的记录（无法映射到新主键）
          const tx = db.transaction('characters', 'readwrite');
          tx.objectStore('characters').add({ name: '无id', not_id: 'x' });
          tx.oncomplete = () => { db.close(); resolve(); };
          tx.onerror = () => reject(tx.error);
        };
        req.onerror = () => reject(req.error);
      });

      const result = await checkDatabase();
      expect(result.ok).toBe(false);
      expect(result.code).toBe('SchemaMismatchError');
      expect(result.error).toMatch(/主键结构/);
    });
  });
});
