/**
 * @module plugins/pluginVfs
 * @description 插件虚拟文件系统 - 基于 IndexedDB 存储插件元数据、文件和 KV 数据
 *
 * 数据库：UtopiaPluginsDB
 * 对象存储：
 *   - plugins:      插件元数据
 *   - plugin_files: 插件文件内容
 *   - plugin_kv:    插件 KV 存储（新增，V2）
 */

const VFS_DB_NAME = 'UtopiaPluginsDB';
const VFS_DB_VERSION = 2;

const STORE_PLUGINS = 'plugins';
const STORE_FILES = 'plugin_files';
const STORE_KV = 'plugin_kv';

let _dbPromise = null;

// ============================================================
// 数据库初始化
// ============================================================

function openVfsDB() {
  if (_dbPromise) return _dbPromise;
  _dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(VFS_DB_NAME, VFS_DB_VERSION);

    req.onupgradeneeded = (event) => {
      const db = event.target.result;

      if (!db.objectStoreNames.contains(STORE_PLUGINS)) {
        const store = db.createObjectStore(STORE_PLUGINS, { keyPath: 'id' });
        store.createIndex('enabled', 'enabled', { unique: false });
        store.createIndex('installedAt', 'installedAt', { unique: false });
      }

      if (!db.objectStoreNames.contains(STORE_FILES)) {
        const store = db.createObjectStore(STORE_FILES, { keyPath: 'key' });
        store.createIndex('pluginId', 'pluginId', { unique: false });
      }

      if (!db.objectStoreNames.contains(STORE_KV)) {
        const store = db.createObjectStore(STORE_KV, { keyPath: 'key' });
        store.createIndex('pluginId', 'pluginId', { unique: false });
      }
    };

    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error('数据库被其他页面阻塞'));
  });
  return _dbPromise;
}

function tx(db, storeNames, mode) {
  return db.transaction(storeNames, mode);
}

function promisify(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

// ============================================================
// 插件元数据操作
// ============================================================

export async function savePlugin(manifest, files, meta = {}) {
  const db = await openVfsDB();

  const pluginRecord = {
    id: manifest.id,
    manifest,
    enabled: meta.enabled ?? false,
    installedAt: meta.installedAt || Date.now(),
    updatedAt: Date.now(),
    source: meta.source || 'unknown',
    sourceUrl: meta.sourceUrl || null,
    fileCount: Object.keys(files).length,
    sizeBytes: Object.values(files).reduce(
      (sum, f) => sum + (f?.byteLength || f?.length || 0),
      0
    ),
  };

  await promisify(
    tx(db, [STORE_PLUGINS], 'readwrite')
      .objectStore(STORE_PLUGINS)
      .put(pluginRecord)
  );

  const txFiles = tx(db, [STORE_FILES], 'readwrite');
  const fileStore = txFiles.objectStore(STORE_FILES);

  const oldKeys = await promisify(
    fileStore.index('pluginId').getAllKeys(manifest.id)
  );
  for (const key of oldKeys) {
    fileStore.delete(key);
  }

  for (const [path, content] of Object.entries(files)) {
    fileStore.put({
      key: `${manifest.id}:${path}`,
      pluginId: manifest.id,
      path,
      content,
      size: content?.byteLength || content?.length || 0,
    });
  }

  await new Promise((resolve, reject) => {
    txFiles.oncomplete = resolve;
    txFiles.onerror = () => reject(txFiles.error);
    txFiles.onabort = () => reject(txFiles.error || new Error('事务被中止'));
  });

  return pluginRecord;
}

export async function getPlugin(pluginId) {
  const db = await openVfsDB();
  return promisify(
    tx(db, [STORE_PLUGINS], 'readonly')
      .objectStore(STORE_PLUGINS)
      .get(pluginId)
  );
}

export async function getAllPlugins() {
  const db = await openVfsDB();
  const list = await promisify(
    tx(db, [STORE_PLUGINS], 'readonly')
      .objectStore(STORE_PLUGINS)
      .getAll()
  );
  return list.sort((a, b) => b.installedAt - a.installedAt);
}

export async function getEnabledPlugins() {
  const db = await openVfsDB();
  const all = await promisify(
    tx(db, [STORE_PLUGINS], 'readonly')
      .objectStore(STORE_PLUGINS)
      .getAll()
  );
  return all.filter(p => p.enabled === true);
}

export async function setPluginEnabled(pluginId, enabled) {
  const db = await openVfsDB();
  const store = tx(db, [STORE_PLUGINS], 'readwrite').objectStore(STORE_PLUGINS);
  const record = await promisify(store.get(pluginId));
  if (!record) throw new Error(`插件不存在: ${pluginId}`);
  record.enabled = enabled;
  record.updatedAt = Date.now();
  await promisify(store.put(record));
  return record;
}

export async function deletePlugin(pluginId) {
  const db = await openVfsDB();

  const txFiles = tx(db, [STORE_FILES], 'readwrite');
  const fileStore = txFiles.objectStore(STORE_FILES);
  const fileKeys = await promisify(
    fileStore.index('pluginId').getAllKeys(pluginId)
  );
  for (const key of fileKeys) fileStore.delete(key);

  await new Promise((resolve, reject) => {
    txFiles.oncomplete = resolve;
    txFiles.onerror = () => reject(txFiles.error);
  });

  const txKv = tx(db, [STORE_KV], 'readwrite');
  const kvStore = txKv.objectStore(STORE_KV);
  const kvKeys = await promisify(
    kvStore.index('pluginId').getAllKeys(pluginId)
  );
  for (const key of kvKeys) kvStore.delete(key);

  await new Promise((resolve, reject) => {
    txKv.oncomplete = resolve;
    txKv.onerror = () => reject(txKv.error);
  });

  await promisify(
    tx(db, [STORE_PLUGINS], 'readwrite')
      .objectStore(STORE_PLUGINS)
      .delete(pluginId)
  );
}

// ============================================================
// 文件操作
// ============================================================

export async function getPluginFile(pluginId, path) {
  const db = await openVfsDB();
  const record = await promisify(
    tx(db, [STORE_FILES], 'readonly')
      .objectStore(STORE_FILES)
      .get(`${pluginId}:${path}`)
  );
  return record?.content || null;
}

export async function getPluginFiles(pluginId) {
  const db = await openVfsDB();
  const records = await promisify(
    tx(db, [STORE_FILES], 'readonly')
      .objectStore(STORE_FILES)
      .index('pluginId')
      .getAll(pluginId)
  );
  const result = {};
  for (const r of records) {
    result[r.path] = r.content;
  }
  return result;
}

// ============================================================
// KV 存储操作
// ============================================================

export async function kvGet(pluginId, key) {
  const db = await openVfsDB();
  const record = await promisify(
    tx(db, [STORE_KV], 'readonly')
      .objectStore(STORE_KV)
      .get(`${pluginId}:${key}`)
  );
  return record ? record.value : undefined;
}

export async function kvSet(pluginId, key, value) {
  const db = await openVfsDB();
  await promisify(
    tx(db, [STORE_KV], 'readwrite')
      .objectStore(STORE_KV)
      .put({
        key: `${pluginId}:${key}`,
        pluginId,
        k: key,
        value,
        updatedAt: Date.now(),
      })
  );
}

export async function kvRemove(pluginId, key) {
  const db = await openVfsDB();
  await promisify(
    tx(db, [STORE_KV], 'readwrite')
      .objectStore(STORE_KV)
      .delete(`${pluginId}:${key}`)
  );
}

export async function kvKeys(pluginId, prefix = '') {
  const db = await openVfsDB();
  const records = await promisify(
    tx(db, [STORE_KV], 'readonly')
      .objectStore(STORE_KV)
      .index('pluginId')
      .getAll(pluginId)
  );
  const allKeys = records.map(r => r.k);
  if (!prefix) return allKeys;
  return allKeys.filter(k => k.startsWith(prefix));
}

export async function kvClear(pluginId) {
  const db = await openVfsDB();
  const txKv = tx(db, [STORE_KV], 'readwrite');
  const kvStore = txKv.objectStore(STORE_KV);
  const keys = await promisify(
    kvStore.index('pluginId').getAllKeys(pluginId)
  );
  for (const key of keys) kvStore.delete(key);
  await new Promise((resolve, reject) => {
    txKv.oncomplete = resolve;
    txKv.onerror = () => reject(txKv.error);
  });
}

// ============================================================
// 清空 VFS（保留数据库）
// ============================================================

export async function clearVfs() {
  const db = await openVfsDB();
  const txAll = tx(db, [STORE_PLUGINS, STORE_FILES, STORE_KV], 'readwrite');
  txAll.objectStore(STORE_PLUGINS).clear();
  txAll.objectStore(STORE_FILES).clear();
  txAll.objectStore(STORE_KV).clear();
  await new Promise((resolve, reject) => {
    txAll.oncomplete = resolve;
    txAll.onerror = () => reject(txAll.error);
  });
}

let _vfsInstance = null;

export function deleteVfsDatabase() {
  return new Promise((resolve, reject) => {
    const doDelete = () => {
      const request = indexedDB.deleteDatabase(VFS_DB_NAME);
      request.onsuccess = () => {
        console.log('[PluginVFS] 数据库已删除');
        resolve();
      };
      request.onerror = (e) => {
        console.error('[PluginVFS] 删除数据库失败:', e.target.error);
        reject(e.target.error || new Error('删除数据库失败'));
      };
      request.onblocked = () => {
        console.warn('[PluginVFS] 删除被阻塞，可能有其他标签页持有连接');
        reject(new Error('插件库删除被阻塞，请关闭其他标签页后重试'));
      };
    };

    const closeAndDelete = () => {
      _dbPromise = null;
      _vfsInstance = null;
      doDelete();
    };

    if (_dbPromise) {
      _dbPromise
        .then((db) => {
          try { db.close(); } catch (_) {}
          closeAndDelete();
        })
        .catch(() => {
          closeAndDelete();
        });
    } else {
      closeAndDelete();
    }
  });
}

// ============================================================
// 单例入口
// ============================================================

export function getPluginVfs() {
  if (!_vfsInstance) {
    _vfsInstance = {
      savePlugin,
      getPlugin,
      getAllPlugins,
      getEnabledPlugins,
      setPluginEnabled,
      deletePlugin,
      getPluginFile,
      getPluginFiles,
      kvGet,
      kvSet,
      kvRemove,
      kvKeys,
      kvClear,
      clearVfs,
      deleteVfsDatabase,
    };
  }
  return _vfsInstance;
}