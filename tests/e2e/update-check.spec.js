import { test, expect } from '@playwright/test';

/**
 * 版本子系统（P3-10 阶段 B）端到端。
 *
 * 守住的正是「更新了却没生效、也不提示」这条链路：
 *   1. 版本号必须能在运行期被读到（window.__utopiaVersion），并与 version.json 一致
 *   2. version.json 必须取到真实最新版本：曾经 SW 会把它缓存起来，导致永远看不到新版本
 *   3. 设置 → 关于 能显示版本，点「检查更新」能正确判定「已是最新 / 发现新版本」
 *   4. 发现新版本时弹的是非阻塞横幅，点「稍后」可关闭且不刷新页面
 *
 * 新版本用 page.route 打桩模拟，不修改仓库里的 version.json。
 */

/**
 * 断开 Service Worker。
 *
 * 必须用：本应用的 SW 在 activate 里调用了 clients.claim()，安装后立刻接管页面，
 * 此后页面发出的请求都经 SW 转发，而 Playwright 的 page.route **不拦截 Service
 * Worker 发起的请求** —— 不打桩就会被真实 version.json 应答，用例会假通过。
 * SW 自身的「version.json 永不进缓存」由 tests/unit/pwa.test.js 的静态断言守住，
 * 这里只测检测与交互链路，因此关掉 SW 不影响覆盖。
 */
async function disableServiceWorker(page) {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'serviceWorker', { value: undefined, configurable: true });
  });
}

async function stubRemoteVersion(page, version) {
  await disableServiceWorker(page);
  await page.route('**/version.json', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      // 必须显式给出 no-store：否则浏览器层面的缓存会让这条用例失真
      headers: { 'Cache-Control': 'no-store' },
      body: JSON.stringify({ version, build: '2026-10-03T00:00:00Z', channel: 'stable' }),
    });
  });
}

async function openAbout(page) {
  await page.waitForFunction(() => window.__utopiaReady === true, null, { timeout: 30_000 });
  await page.locator('#settingsBtn').click();
  const about = page.locator('.settings-section', { hasText: '关于' }).first();
  await expect(about).toBeVisible();
  return about;
}

test.describe('版本子系统', () => {
  test('版本号可在运行期读取，且与 version.json 一致', async ({ page }) => {
    await page.goto('/');
    await page.waitForFunction(() => window.__utopiaReady === true, null, { timeout: 30_000 });

    const served = await page.evaluate(async () => {
      const res = await fetch('./version.json', { cache: 'no-store' });
      return (await res.json()).version;
    });

    const running = await page.evaluate(() => window.__utopiaVersion);
    expect(running, 'window.__utopiaVersion 未挂载：排障时无法确认当前跑的是哪一版').toBeTruthy();
    expect(running).toBe(served);
  });

  test('已是最新版本时给出明确反馈', async ({ page }) => {
    const served = await page.request.get('./version.json').then((r) => r.json());
    await stubRemoteVersion(page, served.version);

    await page.goto('/');
    const about = await openAbout(page);

    await expect(about.locator('#aboutAppVersion')).toHaveText(`v${served.version}`);
    await about.locator('#checkUpdateBtn').click();
    await expect(about.locator('#aboutUpdateStatus')).toContainText('已是最新版本');
  });

  test('远端版本更新时：非阻塞横幅 + 设置页给出更新入口', async ({ page }) => {
    await stubRemoteVersion(page, '9.9.9');

    await page.goto('/');
    await page.waitForFunction(() => window.__utopiaReady === true, null, { timeout: 30_000 });

    // 1) 启动守护（延迟 3s）应自动弹出非阻塞横幅
    const banner = page.locator('#appUpdateBanner');
    await expect(banner).toBeVisible({ timeout: 20_000 });
    await expect(banner.locator('.app-update-text')).toContainText('发现新版本 v9.9.9');

    // 2) 点「稍后」关闭横幅，页面不应被刷新
    await page.evaluate(() => { window.__notReloaded = true; });
    await banner.locator('.app-update-later').click();
    await expect(page.locator('#appUpdateBanner')).toHaveCount(0);
    expect(await page.evaluate(() => window.__notReloaded)).toBe(true);

    // 3) 设置页内的手动检查同样能发现问题，并给出更新按钮
    const about = await openAbout(page);
    await about.locator('#checkUpdateBtn').click();
    await expect(about.locator('#aboutUpdateStatus')).toContainText('发现新版本 v9.9.9');
    await expect(about.locator('button', { hasText: '更新到 v9.9.9' })).toBeVisible();
  });
});
