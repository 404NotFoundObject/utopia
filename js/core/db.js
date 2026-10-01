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

      // keyPath 不匹配的 store：在「迁移前已读取数据」的前提下，删除并按新主键重建
      const actualKeyPath = store.keyPath === '' || store.keyPath === undefined ? null : store.keyPath;
      if (actualKeyPath !== schema.keyPath && _pendingMigrations.has(storeName)) {
        db.deleteObjectStore(storeName);
        store = db.createObjectStore(storeName, { keyPath: schema.keyPath });
        _migratedStoreNames.add(storeName);
      }
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

// keyPath 不匹配 store 的「升级前读取」数据缓存：storeName -> 旧记录数组
const _pendingMigrations = new Map();
// 本轮 upgrade 中已重建主键的 store 集合
const _migratedStoreNames = new Set();

// ============================================================
// Schema 探测
// ============================================================

/**
 * 探测已打开的库与 EXPECTED_SCHEMA 之间的偏差。
 *
 * 三类偏差分开返回，因为处置方式完全不同：
 *   - missingStores / missingIndexes：可通过抬升版本号触发 upgrade 自动补齐，**不丢数据**
 *   - keyPathMismatches：主键路径不一致无法无损修复（改 keyPath 必须重建该 store），
 *     只能交回上层提示用户决策
 *
 * @param {IDBDatabase} db
 * @returns {{
 *   missingStores: string[],
 *   missingIndexes: Array<{store: string, index: string}>,
 *   keyPathMismatches: Array<{store: string, actual: string|null, expected: string}>,
 * }}
 */
function inspectSchema(db) {
  const missingStores = [];
  const missingIndexes = [];
  const keyPathMismatches = [];

  const existingNames = Array.from(db.objectStoreNames);
  const tx = existingNames.length > 0 ? db.transaction(existingNames, 'readonly') : null;

  for (const [storeName, schema] of Object.entries(EXPECTED_SCHEMA)) {
    if (!existingNames.includes(storeName)) {
      missingStores.push(storeName);
      continue;
    }

    const store = tx.objectStore(storeName);

    // 未指定 keyPath 时 IndexedDB 返回空字符串（外置主键），统一归一化为 null 便于比较
    const actualKeyPath = store.keyPath === '' || store.keyPath === undefined ? null : store.keyPath;
    if (actualKeyPath !== schema.keyPath) {
      keyPathMismatches.push({ store: storeName, actual: actualKeyPath, expected: schema.keyPath });
    }

    for (const idx of schema.indexes || []) {
      if (!store.indexNames.contains(idx.name)) {
        missingIndexes.push({ store: storeName, index: idx.name });
      }
    }
  }

  return { missingStores, missingIndexes, keyPathMismatches };
}

/**
 * 构造主键结构不兼容的错误，信息里点名具体是哪张表。
 * @param {Array<{store: string, actual: string|null, expected: string}>} mismatches
 * @returns {Error}
 */
function makeSchemaMismatchError(mismatches) {
  const detail = mismatches
    .map(m => {
      const actual = m.actual === null ? '外置主键' : `"${m.actual}"`;
      return `${m.store}（库中为 ${actual}，期望 "${m.expected}"）`;
    })
    .join('；');
  const err = new Error(
    `数据库主键结构与当前版本不兼容：${detail}。` +
    `主键路径无法就地修改，需要删除并重建数据库。`
  );
  err.name = 'SchemaMismatchError';
  return err;
}

// ============================================================
// 打开数据库
// ============================================================

/**
 * 按指定版本打开数据库。
 * 传入 undefined 表示沿用已有的当前版本（不存在则建为 v1）。
 * @param {number|undefined} version
 * @returns {Promise<IDBDatabase>}
 */
function openAtVersion(version) {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, version);

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

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () => {
      console.warn('[DB] 打开被阻塞，可能有其他页面正在使用旧版本');
      reject(new Error('数据库被其他页面阻塞，请关闭其他标签页后重试'));
    };
  });
}

/**
 * 校验并按需修复 schema。
 *
 * 修复策略（顺序很重要）：
 *   1. 先查主键结构——不一致就直接报错，不进入修复流程，避免用错误的 keyPath 继续跑
 *   2. 缺表/缺索引 → 关闭当前连接，抬升版本号重开，由 ensureSchema 补齐（数据全保留）
 *   3. 修复后再校验一次，仍不完整则报错
 *
 * @param {IDBDatabase} db
 * @returns {Promise<IDBDatabase>}
 */
async function ensureSchemaCompatible(db) {
  const first = inspectSchema(db);

  if (first.keyPathMismatches.length > 0) {
    // 记录级迁移（审计 P1-13）：不再直接删整库，而是先读出旧数据，
    // 触发 upgrade 重建主键，再把数据无损写回。迁移失败才降级报错。
    const migrated = await migrateKeyPaths(db, first.keyPathMismatches);
    if (migrated) {
      return openDB(); // 迁移完成，重新走一次兼容校验
    }
    db.close();
    throw makeSchemaMismatchError(first.keyPathMismatches);
  }

  if (first.missingStores.length === 0 && first.missingIndexes.length === 0) {
    return db;
  }

  // 注意：必须用「已有版本 + 1」并保证不低于 DB_VERSION。
  // 少了 +1 不会触发 upgrade（版本没变），而低于现有版本又会直接抛 VersionError。
  const repairVersion = Math.max(db.version + 1, DB_VERSION);
  console.warn(
    `[DB] schema 不完整（缺 ${first.missingStores.length} 张表、${first.missingIndexes.length} 个索引），` +
    `正在自动补全至 v${repairVersion}…`
  );

  db.close();

  const repaired = await openAtVersion(repairVersion);
  const second = inspectSchema(repaired);

  if (second.missingStores.length > 0 || second.missingIndexes.length > 0) {
    repaired.close();
    const err = new Error(
      `数据库 schema 自动补全失败，仍缺少：${second.missingStores.join(', ') || '（无缺表）'}。`
    );
    err.name = 'SchemaRepairFailedError';
    throw err;
  }
  if (second.keyPathMismatches.length > 0) {
    repaired.close();
    throw makeSchemaMismatchError(second.keyPathMismatches);
  }

  console.log('[DB] schema 自动补全完成，原有数据已保留');
  return repaired;
}

/**
 * 记录级迁移主键：对每个 keyPath 不匹配的 store，先读出旧数据并缓存在
 * _pendingMigrations，关闭旧连接，触发 upgrade（onupgradeneeded 里
 * deleteObjectStore + createObjectStore 重建主键），再写回缓存的数据。
 *
 * 仅当「新 keyPath 字段在旧记录中确实存在」时才无损迁移；
 * 否则返回 false，交由上层按原逻辑报错（提示用户决策）。
 */
async function migrateKeyPaths(db, mismatches) {
  const records = {};
  let hasData = false;
  try {
    for (const m of mismatches) {
      const all = await new Promise((resolve, reject) => {
        const tx = db.transaction(m.store, 'readonly');
        const req = tx.objectStore(m.store).getAll();
        req.onsuccess = () => resolve(req.result || []);
        req.onerror = () => reject(req.error);
      });

      // 空库不做「迁移」——keyPath 不匹配仍是结构错误，交由上层按原逻辑报错
      if (all.length === 0) {
        console.warn(`[DB] ${m.store} 无数据，keyPath 不匹配仍视为结构错误`);
        return false;
      }
      // 校验新 keyPath 字段存在
      if (all.some(r => !(m.expected in r))) {
        console.warn(`[DB] 无法无损迁移 ${m.store}：部分记录缺少 "${m.expected}" 字段`);
        return false;
      }
      records[m.store] = all;
      hasData = true;
    }
  } catch (e) {
    console.error('[DB] 迁移前读取失败:', e);
    return false;
  }

  if (!hasData) return false;

  // 缓存待迁移数据 + 关闭旧连接 + 抬升版本触发 upgrade
  for (const [storeName, list] of Object.entries(records)) {
    _pendingMigrations.set(storeName, list);
  }
  db.close();

  const targetVersion = db.version + 1;
  let upgraded;
  try {
    upgraded = await openAtVersion(targetVersion);
  } catch (e) {
    _pendingMigrations.clear();
    throw e;
  }

  // 写回数据
  try {
    for (const [storeName, list] of Object.entries(records)) {
      await new Promise((resolve, reject) => {
        const tx = upgraded.transaction(storeName, 'readwrite');
        const store = tx.objectStore(storeName);
        for (const rec of list) store.put(rec);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
    }
    _pendingMigrations.clear();
    console.log(`[DB] 主键迁移完成，共 ${Object.keys(records).length} 张表数据无损保留`);
    upgraded.close();
    return true;
  } catch (e) {
    console.error('[DB] 迁移后写回失败:', e);
    _pendingMigrations.clear();
    upgraded.close();
    return false;
  }
}

export function openDB() {
  return openAtVersion(DB_VERSION)
    .catch((err) => {
      // 已有库的版本高于 DB_VERSION（例如上次自愈抬升过版本），改用其当前版本打开
      if (err && err.name === 'VersionError') {
        console.warn(`[DB] 已有数据库版本高于 v${DB_VERSION}，按现有版本打开`);
        return openAtVersion(undefined);
      }
      throw err;
    })
    .then(ensureSchemaCompatible);
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
// 通用键级串行锁
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
  let db = null;
  try {
    db = await openDB();

    // IDBObjectStore.count() 返回的是 IDBRequest 而非 Promise，
    // 直接 await 会立刻拿到请求对象本身、拿不到任何失败信息。
    // 必须包一层 Promise 才真正起到「试读」的作用。
    await new Promise((resolve, reject) => {
      const tx = db.transaction('characters', 'readonly');
      const request = tx.objectStore('characters').count();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });

    return { ok: true };
  } catch (error) {
    console.error('[DB] 数据库检查失败:', error);
    return {
      ok: false,
      error: error.message || '未知错误',
      code: error.name || 'UnknownError'
    };
  } finally {
    // openDB() 返回的连接不受 dbInstance 管理，这里必须自己关闭，
    // 否则会留下一个活动连接，使后续 deleteDatabase() 触发 onblocked。
    if (db) {
      try { db.close(); } catch (_) {}
    }
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