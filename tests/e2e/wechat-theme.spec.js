import { test, expect } from '@playwright/test';

/**
 * 微信主题（实验功能）验证。
 *
 * 主题通过 localStorage 预置（initTheme 启动时从 localStorage 恢复），
 * 不依赖设置面板的 UI 流程；默认主题（light）下既有用例不受影响。
 *
 * 视图状态机（data-wx-mobile-view 的写入规则）由单测覆盖，
 * 本文件验证浏览器中的 CSS 结构：主题变量、图标栏重排、
 * 移动端列表层/对话页互斥与返回按钮。
 */

const READY = () => Boolean(window.__utopiaReady);

async function openWithTheme(page, themeId) {
  await page.addInitScript((theme) => {
    localStorage.setItem('utopia-theme', theme);
  }, themeId);
  await page.goto('/');
  await page.waitForFunction(READY, null, { timeout: 30_000 });
}

test.describe('微信主题 · 桌面', () => {
  test.beforeEach(async ({ page }) => {
    test.skip(page.viewportSize().width <= 768, '仅桌面视口');
  });

  test('浅色微信：变量注入 + 最左图标栏 + 方头像', async ({ page }) => {
    await openWithTheme(page, 'wechat');

    await expect(page.locator('html')).toHaveAttribute('data-theme', 'wechat');

    const primary = await page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue('--color-primary').trim()
    );
    expect(primary).toBe('#07c160');

    // 侧栏 footer 重排为最左垂直图标栏
    const footerBox = await page.locator('.sidebar-footer').boundingBox();
    expect(footerBox.x).toBeLessThan(8);
    expect(footerBox.width).toBeLessThan(70);

    // 列表列让出图标栏宽度
    const sidebarBox = await page.locator('#sidebar').boundingBox();
    expect(sidebarBox.x).toBeGreaterThanOrEqual(50);

    // 头像方形圆角（默认主题下是全圆）
    const radius = await page.evaluate(() =>
      getComputedStyle(document.getElementById('charAvatar')).borderRadius
    );
    expect(radius).toBe('6px');
  });

  test('暗色微信：data-theme 与背景变量', async ({ page }) => {
    await openWithTheme(page, 'wechat-dark');

    await expect(page.locator('html')).toHaveAttribute('data-theme', 'wechat-dark');
    const bg = await page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue('--color-bg-primary').trim()
    );
    expect(bg).toBe('#111111');
  });
});

test.describe('微信主题 · 移动端', () => {
  test.beforeEach(async ({ page }) => {
    test.skip(page.viewportSize().width > 768, '仅移动视口');
  });

  test('列表层全屏 + 底部 dock + 两层互斥切换', async ({ page }) => {
    await openWithTheme(page, 'wechat');

    // 默认落在列表层
    await expect(page.locator('body')).toHaveAttribute('data-wx-mobile-view', 'list');
    await expect(page.locator('#sidebar')).toBeVisible();

    const vp = page.viewportSize();
    const sidebarBox = await page.locator('#sidebar').boundingBox();
    expect(sidebarBox.width).toBeGreaterThanOrEqual(vp.width - 2);

    // dock 贴住视口底部
    const footerBox = await page.locator('.sidebar-footer').boundingBox();
    expect(footerBox.y + footerBox.height).toBeGreaterThanOrEqual(vp.height - 4);

    // 汉堡退场
    await expect(page.locator('#mobileMenuToggle')).toBeHidden();

    // 进入对话页视图：列表层隐藏、返回按钮可见
    await page.evaluate(() => {
      document.body.dataset.wxMobileView = 'chat';
    });
    await expect(page.locator('#sidebar')).toBeHidden();
    await expect(page.locator('#main')).toBeVisible();
    await expect(page.locator('#wxBackBtn')).toBeVisible();

    // 返回按钮 → 列表层
    await page.locator('#wxBackBtn').click();
    await expect(page.locator('body')).toHaveAttribute('data-wx-mobile-view', 'list');
    await expect(page.locator('#sidebar')).toBeVisible();
  });
});
