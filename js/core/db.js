// js/core/db.js - IndexedDB 封装（声明式 schema 对齐 + 自动索引补全）

const DB_NAME = 'UtopiaDB';
const DB_VERSION = 9;

const EXPECTED_SCHEMA = {
  characters: {
    keyPath: 'id',
    indexes: [
      { name: 'name', keyPath: 'name' },
      { name: 'createdAt', keyPath: 'createdAt' },
    ],
  },
  conversations: {
    keyPath: 'id',
    indexes: [
      { name: 'characterId', keyPath: 'characterId' },
      { name: 'updatedAt', keyPath: 'updatedAt' },
    ],
  },
  settings: {
    keyPath: 'id',
    indexes: [],
  },
  memories: {
    keyPath: 'id',
    indexes: [
      { name: 'characterId', keyPath: 'characterId' },
      { name: 'timestamp', keyPath: 'timestamp' },
    ],
  },
  time_state: {
    keyPath: 'id',
    indexes: [],
  },
  posts: {
    keyPath: 'id',
    indexes: [
      { name: 'authorId', keyPath: 'authorId' },
      { name: 'timestamp', keyPath: 'timestamp' },
      { name: 'authorType', keyPath: 'authorType' },
    ],
  },
  world_book: {
    keyPath: 'id',
    indexes: [
      { name: 'scope', keyPath: 'scope' },
      { name: 'enabled', keyPath: 'enabled' },
      { name: 'category', keyPath: 'category' },
      { name: 'groupId', keyPath: 'groupId' },
    ],
  },
  groups: {
    keyPath: 'id',
    indexes: [
      { name: 'status', keyPath: 'status' },
      { name: 'createdAt', keyPath: 'createdAt' },
    ],
  },
  group_members: {
    keyPath: 'id',
    indexes: [
      { name: 'groupId', keyPath: 'groupId' },
      { name: 'memberId', keyPath: 'memberId' },
      { name: 'memberType', keyPath: 'memberType' },
    ],
  },
  group_messages: {
    keyPath: 'id',
    indexes: [
      { name: 'groupId', keyPath: 'groupId' },
      { name: 'senderId', keyPath: 'senderId' },
      { name: 'timestamp', keyPath: 'timestamp' },
    ],
  },
  rule_groups: {
    keyPath: 'id',
    indexes: [
      { name: 'enabled', keyPath: 'enabled' },
      { name: 'parentGroupId', keyPath: 'parentGroupId' },
      { name: 'exclusiveGroup', keyPath: 'exclusiveGroup' },
      { name: 'createdAt', keyPath: 'createdAt' },
    ],
  },
};

function ensureSchema(db, transaction) {
  let createdStores = 0;
  let createdIndexes = 0;

  for (const [storeName, schema] of Object.entries(EXPECTED_SCHEMA)) {
    let store;

    if (!db.objectStoreNames.contains(storeName)) {
      store = db.createObjectStore(storeName, { keyPath: schema.keyPath });
      createdStores++;
    } else {
      store = transaction.objectStore(storeName);
    }

    for (const idx of schema.indexes || []) {
      if (!store.indexNames.contains(idx.name)) {
        store.createIndex(idx.name, idx.keyPath, { unique: idx.unique || false });
        createdIndexes++;
      }
    }
  }

  if (createdStores > 0) {
    console.log(`[DB] 创建了 ${createdStores} 个 store`);
  }
  if (createdIndexes > 0) {
    console.log(`[DB] 补全了 ${createdIndexes} 个索引`);
  }
  if (createdStores === 0 && createdIndexes === 0) {
    console.log('[DB] schema 已对齐，无需变更');
  }
}

export function openDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      const transaction = event.target.transaction;

      console.log(`[DB] 升级路径: v${event.oldVersion} → v${event.newVersion}`);

      try {
        ensureSchema(db, transaction);
        console.log('[DB] schema 对齐完成');
      } catch (err) {
        console.error('[DB] schema 对齐失败:', err);
        throw err;
      }
    };

    request.onsuccess = () => {
      const db = request.result;

      const missing = [];
      for (const storeName of Object.keys(EXPECTED_SCHEMA)) {
        if (!db.objectStoreNames.contains(storeName)) {
          missing.push(storeName);
        }
      }
      if (missing.length > 0) {
        console.error(
          `[DB] ⚠️ 打开的 DB 缺少 store: ${missing.join(', ')}。` +
          `这不应该发生，请检查浏览器兼容性或报告 bug。`
        );
      }

      resolve(db);
    };

    request.onerror = () => reject(request.error);
    request.onblocked = () => {
      console.warn('[DB] 打开被阻塞，可能有其他页面正在使用旧版本');
      reject(new Error('数据库被其他页面阻塞，请关闭其他标签页后重试'));
    };
  });
}

function createStore(db, storeName) {
  return {
    add: (data) => new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, 'readwrite');
      const store = tx.objectStore(storeName);
      const req = store.add(data);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    }),
    get: (id) => new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, 'readonly');
      const store = tx.objectStore(storeName);
      const req = store.get(id);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    }),
    getAll: () => new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, 'readonly');
      const store = tx.objectStore(storeName);
      const req = store.getAll();
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    }),
    update: (id, data) => new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, 'readwrite');
      const store = tx.objectStore(storeName);
      const req = store.put({ ...data, id });
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    }),
    delete: (id) => new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, 'readwrite');
      const store = tx.objectStore(storeName);
      const req = store.delete(id);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    }),
    getByIndex: (indexName, value) => new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, 'readonly');
      const store = tx.objectStore(storeName);
      const index = store.index(indexName);
      const req = index.getAll(value);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    }),
  };
}

let dbInstance = null;

export async function getDB() {
  if (!dbInstance) {
    dbInstance = await openDB();
  }
  return dbInstance;
}

export async function getStores() {
  const db = await getDB();
  return {
    characters: createStore(db, 'characters'),
    conversations: createStore(db, 'conversations'),
    settings: createStore(db, 'settings'),
    memories: createStore(db, 'memories'),
    time_state: createStore(db, 'time_state'),
    posts: createStore(db, 'posts'),
    world_book: createStore(db, 'world_book'),
    groups: createStore(db, 'groups'),
    group_members: createStore(db, 'group_members'),
    group_messages: createStore(db, 'group_messages'),
    rule_groups: createStore(db, 'rule_groups'),
  };
}

// ============================================================
// AUD-12/13/15/17：通用键级串行锁
// ============================================================
//
// 用法：
//   await withKeyLock('conversation', convId, async () => {
//     const stores = await getStores();
//     const conv = await stores.conversations.get(convId);
//     // ... 读-改-写
//   });
//
// 语义：
//   - 同一个 namespace + key 的 fn 按调用顺序串行执行
//   - 不同 namespace 或不同 key 之间互不阻塞
//   - 锁释放后立即清理 Map 条目（无泄漏）
//   - fn 内不能再调用走同一把锁的函数（会导致自锁）
// ============================================================

const _keyLocks = new Map();

export async function withKeyLock(namespace, key, fn) {
  const lockKey = `${namespace}:${key}`;
  const prev = _keyLocks.get(lockKey) || Promise.resolve();
  let release;
  const current = new Promise(r => { release = r; });
  _keyLocks.set(lockKey, current);

  try {
    await prev;
  } catch (_) {}

  try {
    return await fn();
  } finally {
    release();
    if (_keyLocks.get(lockKey) === current) {
      _keyLocks.delete(lockKey);
    }
  }
}

export async function checkDatabase() {
  try {
    const db = await openDB();
    const tx = db.transaction('characters', 'readonly');
    const store = tx.objectStore('characters');
    await store.count();
    return { ok: true };
  } catch (error) {
    console.error('[DB] 数据库检查失败:', error);
    return {
      ok: false,
      error: error.message || '未知错误',
      code: error.name || 'UnknownError'
    };
  }
}

export function deleteDatabase() {
  return new Promise((resolve, reject) => {
    if (dbInstance) {
      try {
        dbInstance.close();
      } catch (_) {}
      dbInstance = null;
    }

    const request = indexedDB.deleteDatabase(DB_NAME);
    request.onsuccess = () => {
      console.log('[DB] 数据库已删除');
      resolve();
    };
    request.onerror = (e) => {
      console.error('[DB] 删除数据库失败:', e.target.error);
      reject(e.target.error);
    };
    request.onblocked = () => {
      console.warn('[DB] 删除操作被阻塞，可能有其他页面正在使用');
      reject(new Error('删除被阻塞，请关闭其他标签页后重试'));
    };
  });
}