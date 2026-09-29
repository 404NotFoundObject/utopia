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

  test('左上角用户头像 + 气泡尾巴与无时间戳', async ({ page }) => {
    await openWithTheme(page, 'wechat');

    // 用户头像注入在图标栏顶部
    const avatarBox = await page.locator('#wxUserAvatar').boundingBox();
    const footerBox = await page.locator('.sidebar-footer').boundingBox();
    expect(avatarBox).not.toBeNull();
    expect(avatarBox.y).toBeLessThan(footerBox.y + 60);

    // 构造一条 AI 消息：时间戳隐藏、气泡带白色左尾巴
    await page.evaluate(() => {
      const list = document.getElementById('chatMessages');
      const row = document.createElement('div');
      row.className = 'message assistant';
      row.innerHTML =
        '<img class="avatar" alt=""><div class="bubble"><div class="bubble-content">你好</div><div class="timestamp">12:00</div></div>';
      list.appendChild(row);
    });
    const info = await page.evaluate(() => {
      const bubble = document.querySelector('#chatMessages .bubble');
      const after = getComputedStyle(bubble, '::after');
      const ts = bubble.querySelector('.timestamp');
      return {
        content: after.content,
        tailColor: after.borderRightColor,
        tsDisplay: ts ? getComputedStyle(ts).display : 'missing',
      };
    });
    expect(info.content).toBe('""');
    expect(info.tailColor).toBe('rgb(255, 255, 255)');
    expect(info.tsDisplay).toBe('none');
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

  test('dock 只保留 聊天 / 插件 / 朋友圈 / 设置 且按序排列', async ({ page }) => {
    await openWithTheme(page, 'wechat');

    const visibleIds = await page.evaluate(() =>
      [...document.querySelectorAll('.sidebar-footer .sidebar-btn')]
        .filter((b) => getComputedStyle(b).display !== 'none')
        .map((b) => b.id)
        .sort()
    );
    expect(visibleIds).toEqual(['pluginBtn', 'settingsBtn', 'socialBtn', 'wxDockChatBtn']);

    // 顺序：聊天最左 → 插件 → 朋友圈 → 设置最右
    const lefts = await page.evaluate(() =>
      ['wxDockChatBtn', 'pluginBtn', 'socialBtn', 'settingsBtn'].map(
        (id) => document.getElementById(id).getBoundingClientRect().left
      )
    );
    for (let i = 0; i < lefts.length - 1; i++) {
      expect(lefts[i]).toBeLessThan(lefts[i + 1]);
    }

    // 汉堡之外，用户头像也不出现在移动端 dock
    await expect(page.locator('#wxUserAvatar')).toBeHidden();
  });

  test('右上角「+」菜单展开并转发动作', async ({ page }) => {
    await openWithTheme(page, 'wechat');

    await expect(page.locator('#wxPlusBtn')).toBeVisible();
    await page.locator('#wxPlusBtn').click();
    await expect(page.locator('#wxPlusMenu')).toBeVisible();
    expect(await page.locator('#wxPlusMenu .wx-menu-item').count()).toBe(5);

    // 点击「导入角色」→ 转发 importBtn.click() → 打开导入模态
    await page.locator('#wxPlusMenu .wx-menu-item', { hasText: '导入角色' }).click();
    await expect(page.locator('#modalOverlay')).toBeVisible();

    // 转发后菜单收起
    await expect(page.locator('#wxPlusMenu')).toBeHidden();
  });
});
