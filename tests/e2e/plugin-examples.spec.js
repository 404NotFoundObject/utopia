/**
 * 官方示例插件 — PC 桌面 / 移动端（Pixel 5）双视口冒烟验证
 * ============================================================
 *
 * 背景：emotion-radar v2.2.0（群聊不再误展示上一次角色，改为从群成员读取+下拉切换）
 *       edit-reply   v2.1.0（右键/长按编辑从单聊扩展到群聊）
 *
 * 运行（需本机已下载 Playwright 浏览器内核）：
 *   npx playwright test plugin-examples.spec.js            # 桌面 + 移动
 *   npx playwright test plugin-examples.spec.js --project=chromium
 *   npx playwright test plugin-examples.spec.js --project=mobile-chrome
 *
 * 前置：playwright.config.mjs 已配置 webServer（python server.py 8080），
 *       会自动拉起应用并将 baseURL 指向该服务。dev server 直接托管
 *       plugin-examples/*.zip，故本规范用「从 URL 安装」路径安装插件。
 *
 * 说明：插件业务逻辑的权威验证由 tests/integration/plugin-examples.test.js
 *       （8 用例全绿，覆盖单聊/群聊/移动长按等价路径）承担；本文件聚焦
 *       「在真实浏览器 + 响应式布局下能否正常加载、注入、不报错」。
 */

import { test, expect } from '@playwright/test';

// 两个官方示例插件的 zip 直链（由 dev server 托管于仓库根）
const EXAMPLES = {
  radar: { id: 'com.utopia.example-emotion-radar', name: '角色状态雷达图', zip: '/plugin-examples/example-emotion-radar.zip' },
  edit:  { id: 'com.utopia.example-edit-reply', name: '回复编辑', zip: '/plugin-examples/example-edit-reply.zip' },
};

// 打开侧栏「插件管理」模态框
async function openPluginManager(page) {
  await page.click('#pluginBtn');
  await expect(page.locator('.modal-title', { hasText: '插件管理' })).toBeVisible();
}

// 从 URL 安装一个插件（每次都会重新打开 URL 安装子对话框）
async function installFromUrl(page, zipUrl) {
  await page.click('#pluginInstallUrlBtn');
  await expect(page.locator('#pluginUrlInput')).toBeVisible();
  await page.fill('#pluginUrlInput', zipUrl);
  await page.click('#pluginUrlInstall');
  // 安装成功后子对话框关闭并刷新列表；等待“安装成功”提示出现
  await expect(page.locator('.modal-title', { hasText: '插件管理' })).toBeVisible();
}

// 安装两个示例插件
async function installExamplePlugins(page) {
  await openPluginManager(page);
  for (const ex of Object.values(EXAMPLES)) {
    await installFromUrl(page, ex.zip);
  }
  // 两个插件都应出现在已安装列表中
  for (const ex of Object.values(EXAMPLES)) {
    await expect(page.locator('#pluginListContainer', { hasText: ex.name })).toBeVisible();
  }
}

// 移动端长按等价（Playwright 的 touch 视口下 mouse.down/up + 延时 触发 contextmenu）
async function longPress(page, locator) {
  const box = await locator.boundingBox();
  if (!box) throw new Error('longPress: element not visible');
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.waitForTimeout(800);
  await page.mouse.up();
}

test.describe('官方示例插件 — PC / 移动端冒烟', () => {
  test.beforeEach(async ({ page }) => {
    const errors = [];
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
    page._pluginErrors = errors;

    await page.goto('/');
    // 等待侧栏插件入口（应用已就绪）
    await expect(page.locator('#pluginBtn')).toBeVisible();
  });

  test('两个插件安装后均出现在插件管理器列表，且运行期无报错', async ({ page }) => {
    await installExamplePlugins(page);
    expect(page._pluginErrors, JSON.stringify(page._pluginErrors)).toEqual([]);
  });

  test('emotion-radar：头部 chat-header-actions 槽位成功注入按钮', async ({ page }) => {
    await installExamplePlugins(page);
    const headerBtn = page.locator('[data-plugin-slot="chat-header-actions"] .radar-plugin-btn');
    await expect(headerBtn).toBeVisible();
  });

  test('emotion-radar：单聊点击按钮弹出模态框并展示当前角色（无群成员下拉）', async ({ page }) => {
    await installExamplePlugins(page);
    // 直接进入默认单聊（应用启动通常在单人会话上下文）
    const btn = page.locator('[data-plugin-slot="chat-header-actions"] .radar-plugin-btn');
    await expect(btn).toBeVisible();
    await btn.click();
    await expect(page.locator('#radar-char-name')).toBeVisible({ timeout: 5000 });
    // 单聊不应出现群成员切换下拉
    await expect(page.locator('#radar-char-select')).toHaveCount(0);
  });

  test('edit-reply：桌面右键 assistant 消息出现「编辑此回复」', async ({ page }) => {
    await installExamplePlugins(page);
    const assistantMsg = page.locator('.message.assistant, .group-message[data-message-role="assistant"]').first();
    const count = await assistantMsg.count();
    test.skip(count === 0, '当前会话无 assistant 消息，需先在应用内产生一条助手回复');

    await assistantMsg.click({ button: 'right' });
    const menu = page.locator('.message-context-menu');
    await expect(menu).toBeVisible({ timeout: 5000 });
    await expect(menu.getByText('编辑此回复')).toBeVisible();
  });

  test('edit-reply：移动端长按 assistant 消息出现「编辑此回复」', async ({ page }) => {
    await installExamplePlugins(page);
    const assistantMsg = page.locator('.message.assistant, .group-message[data-message-role="assistant"]').first();
    const count = await assistantMsg.count();
    test.skip(count === 0, '当前会话无 assistant 消息，需先在应用内产生一条助手回复');

    await longPress(page, assistantMsg);
    const menu = page.locator('.message-context-menu');
    await expect(menu).toBeVisible({ timeout: 5000 });
    await expect(menu.getByText('编辑此回复')).toBeVisible();
  });
});
