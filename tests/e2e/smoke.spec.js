import { test, expect } from '@playwright/test';

/**
 * 应用启动冒烟测试。
 *
 * 关注点：应用能否在真实浏览器中完成冷启动——资源加载、DB 建库、
 * 首屏渲染，且过程中没有未捕获的 JS 异常。
 *
 * 刻意不断言 CDN 资源加载成功：调用方（marked / DOMPurify / MiniSearch /
 * Font Awesome）来自 jsdelivr 与 cdnjs，离线环境下加载失败是预期内的，
 * 不应让冒烟测试因此变红。真正要守住的是「应用自身的代码不抛异常」。
 */

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

test.describe('应用启动冒烟', () => {
  test('页面可访问且标题正确', async ({ page }) => {
    const response = await page.goto('/');
    expect(response?.status()).toBe(200);
    await expect(page).toHaveTitle(/Utopia/);
  });

  test('首屏骨架渲染完成', async ({ page }) => {
    await page.goto('/');

    await expect(page.locator('#sidebar')).toBeVisible();
    await expect(page.locator('#sidebar .logo')).toContainText('Utopia');
    await expect(page.locator('#characterList')).toBeAttached();

    // 欢迎页在未选择角色时展示
    await expect(page.locator('#welcomePage h1')).toContainText('Utopia');
    await expect(page.locator('#welcomePage')).toContainText('永远的理想国');
  });

  test('初始化完成后没有未捕获的 JS 异常', async ({ page }) => {
    const pageErrors = [];
    page.on('pageerror', (err) => pageErrors.push(err.message));

    await page.goto('/');
    // window.__eventBus 在 checkDatabase() 通过后挂载，可作为"启动成功"的信号
    await page.waitForFunction(() => Boolean(window.__eventBus), null, { timeout: 30_000 });

    expect(pageErrors, `未捕获异常：\n${pageErrors.join('\n')}`).toEqual([]);
  });

  test('IndexedDB 建库成功且表结构完整', async ({ page }) => {
    await page.goto('/');
    await page.waitForFunction(() => Boolean(window.__eventBus), null, { timeout: 30_000 });

    const info = await page.evaluate(() => new Promise((resolve) => {
      const req = indexedDB.open('UtopiaDB');
      req.onsuccess = () => {
        const db = req.result;
        const result = { version: db.version, stores: Array.from(db.objectStoreNames) };
        db.close();
        resolve(result);
      };
      req.onerror = () => resolve({ error: String(req.error) });
    }));

    expect(info.error, `打开数据库失败：${info.error}`).toBeUndefined();
    expect(info.version).toBeGreaterThanOrEqual(9);
    for (const store of EXPECTED_STORES) {
      expect(info.stores, `缺少 store: ${store}`).toContain(store);
    }
  });

  test('启动时不会弹出数据库错误对话框', async ({ page }) => {
    await page.goto('/');
    await page.waitForFunction(() => Boolean(window.__eventBus), null, { timeout: 30_000 });

    // 数据库异常时 app.js 会打开模态框并提示"数据库初始化失败"
    await expect(page.locator('#modalOverlay')).toHaveClass(/hidden/);
    await expect(page.locator('#modalContent')).not.toContainText('数据库初始化失败');
  });

  test('应用版本写入 localStorage，用于后续更新检测', async ({ page }) => {
    await page.goto('/');
    await page.waitForFunction(() => Boolean(window.__eventBus), null, { timeout: 30_000 });

    const version = await page.evaluate(() => localStorage.getItem('utopia_app_version'));
    expect(version).toMatch(/^\d+\.\d+\.\d+$/);
  });

  test('刷新页面后仍能正常启动（复用已建好的库）', async ({ page }) => {
    const pageErrors = [];
    page.on('pageerror', (err) => pageErrors.push(err.message));

    await page.goto('/');
    await page.waitForFunction(() => Boolean(window.__eventBus), null, { timeout: 30_000 });

    await page.reload();
    await page.waitForFunction(() => Boolean(window.__eventBus), null, { timeout: 30_000 });

    await expect(page.locator('#sidebar')).toBeVisible();
    expect(pageErrors).toEqual([]);
  });

  test('移动端视口下侧栏可折叠', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/');
    await page.waitForFunction(() => Boolean(window.__eventBus), null, { timeout: 30_000 });

    // 窄屏下汉堡按钮应可见
    await expect(page.locator('#mobileMenuToggle')).toBeVisible();
  });
});
