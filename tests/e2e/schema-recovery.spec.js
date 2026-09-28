import { test, expect } from '@playwright/test';

/**
 * Schema 失配恢复（真实浏览器）。
 *
 * 复现并守护线上报过的场景：
 *   浏览器里已存在一个「版本号相同但 schema 不同」的 UtopiaDB。由于版本号未变，
 *   upgrade 不触发，schema 不会被修正，应用带着缺表的库继续跑，最终在
 *   loadSettings 处抛出 DataError，报错信息完全无法指向真正的成因。
 *
 * 期望行为：应用自动补全缺失的表并正常启动，用户数据不受影响。
 *
 * 实现要点：必须先在一个「不加载应用」的页面上把旧库造好，再导航到应用。
 * 若先打开应用，它会持有连接，deleteDatabase 会被 onblocked 挡住。
 * 这里借用 404 页面来取得同源环境。
 */

const EXPECTED_STORE_COUNT = 11;

/** 在一个已建立的同源页面上，把 UtopiaDB 造成指定的旧结构 */
async function seedLegacyDatabase(page, storeDefs) {
  return page.evaluate(async (defs) => {
    // 清掉可能存在的新库，确保从零开始造
    await new Promise((resolve) => {
      const del = indexedDB.deleteDatabase('UtopiaDB');
      del.onsuccess = () => resolve();
      del.onerror = () => resolve();
      del.onblocked = () => resolve();
    });

    await new Promise((resolve, reject) => {
      const req = indexedDB.open('UtopiaDB', 9);
      req.onupgradeneeded = () => {
        const db = req.result;
        for (const [name, opts] of Object.entries(defs)) {
          db.createObjectStore(name, opts);
        }
      };
      req.onsuccess = () => { req.result.close(); resolve(); };
      req.onerror = () => reject(req.error);
    });
  }, storeDefs);
}

async function readDatabaseInfo(page) {
  return page.evaluate(() => new Promise((resolve) => {
    const req = indexedDB.open('UtopiaDB');
    req.onsuccess = () => {
      const db = req.result;
      const result = { version: db.version, stores: Array.from(db.objectStoreNames) };
      db.close();
      resolve(result);
    };
    req.onerror = () => resolve({ error: String(req.error) });
  }));
}

test.describe('Schema 失配恢复', () => {
  test('旧库缺 8 张表时自动补全并正常启动', async ({ page }) => {
    const pageErrors = [];
    page.on('pageerror', (err) => pageErrors.push(err.message));

    // 1. 借 404 页面取得同源上下文（此时尚未加载任何应用脚本）
    await page.goto('/__seed__', { waitUntil: 'domcontentloaded' });

    // 2. 造一个只有 3 张表、但版本同为 v9 的旧库
    await seedLegacyDatabase(page, {
      characters: { keyPath: 'id' },
      settings: { keyPath: 'id' },
      memories: { keyPath: 'id' },
    });

    const before = await readDatabaseInfo(page);
    expect(before.stores).toHaveLength(3);
    expect(before.version).toBe(9);

    // 3. 打开应用
    await page.goto('/');
    await page.waitForFunction(() => Boolean(window.__eventBus), null, { timeout: 30_000 });

    // 4. 应用应正常启动，且库被补全
    const after = await readDatabaseInfo(page);
    expect(after.stores).toHaveLength(EXPECTED_STORE_COUNT);
    for (const store of [
      'conversations', 'time_state', 'posts', 'world_book',
      'groups', 'group_members', 'group_messages', 'rule_groups',
    ]) {
      expect(after.stores, `缺少 store: ${store}`).toContain(store);
    }

    expect(pageErrors, `未捕获异常：\n${pageErrors.join('\n')}`).toEqual([]);
  });

  test('自愈过程不会丢失旧库中已有的数据', async ({ page }) => {
    await page.goto('/__seed__', { waitUntil: 'domcontentloaded' });

    await seedLegacyDatabase(page, {
      characters: { keyPath: 'id' },
      settings: { keyPath: 'id' },
      memories: { keyPath: 'id' },
    });

    // 往旧库写一条角色
    await page.evaluate(() => new Promise((resolve, reject) => {
      const req = indexedDB.open('UtopiaDB', 9);
      req.onsuccess = () => {
        const db = req.result;
        const tx = db.transaction('characters', 'readwrite');
        tx.objectStore('characters').add({ id: 'legacy-1', name: '旧角色', createdAt: 1 });
        tx.oncomplete = () => { db.close(); resolve(); };
        tx.onerror = () => reject(tx.error);
      };
      req.onerror = () => reject(req.error);
    }));

    await page.goto('/');
    await page.waitForFunction(() => Boolean(window.__eventBus), null, { timeout: 30_000 });

    const kept = await page.evaluate(() => new Promise((resolve) => {
      const req = indexedDB.open('UtopiaDB');
      req.onsuccess = () => {
        const db = req.result;
        const tx = db.transaction('characters', 'readonly');
        const get = tx.objectStore('characters').get('legacy-1');
        get.onsuccess = () => { db.close(); resolve(get.result ?? null); };
        get.onerror = () => { db.close(); resolve(null); };
      };
      req.onerror = () => resolve(null);
    }));

    expect(kept).not.toBeNull();
    expect(kept.name).toBe('旧角色');
  });

  test('主键结构不兼容时给出可读提示，而不是抛 DataError', async ({ page }) => {
    await page.goto('/__seed__', { waitUntil: 'domcontentloaded' });

    // settings 的主键路径与当前代码不符
    await seedLegacyDatabase(page, {
      characters: { keyPath: 'id' },
      settings: { keyPath: 'key' },
      memories: { keyPath: 'id' },
    });

    await page.goto('/');

    // 应用应当弹出重建对话框，而不是带着坏库继续跑
    await expect(page.locator('#modalContent')).toContainText('数据库初始化失败', { timeout: 20_000 });
    await expect(page.locator('#modalContent')).toContainText('主键结构');

    // 不应出现底层 DataError
    await expect(page.locator('#modalContent')).not.toContainText('DataError');
  });
});
