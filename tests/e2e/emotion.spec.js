import { test, expect } from '@playwright/test';

/**
 * 情绪识别的端到端验证。
 *
 * 单元测试已经覆盖了识别逻辑（tests/unit/modules/emotionClassifier.test.js），
 * 这里只验证它在真实浏览器里确实被接上了：设置项可配置、调试面板可打开、
 * 面板里能跑出正确的结论。
 */

/**
 * 打开应用并等待可交互。
 *
 * 注意必须等 __utopiaReady 而不是 __eventBus：
 * 后者在数据库校验通过后就挂载，那时侧栏按钮的事件绑定还没完成，
 * 此时点击 #settingsBtn 不会有任何反应。
 *
 * 超时给到 45s：应用自身冷启动实测约 3s（见 TESTING.md 的「冷启动耗时」一节），
 * 但 index.html 在 <head> 里以阻塞式 <script> 引入 marked / DOMPurify / MiniSearch
 * 三个 CDN 库，任一 CDN 抖动都会拖慢整页解析。这里留足余量，避免把外部
 * 网络抖动误报成应用缺陷。
 */
async function bootApp(page) {
  await page.goto('/');
  await page.waitForFunction(() => Boolean(window.__utopiaReady), null, { timeout: 45_000 });
}

/**
 * 打开设置弹窗并等待其渲染完成。
 *
 * 侧栏在两种视口下的结构不同（见 js/ui/layout/sidebar.js 的 isMobile 分支）：
 *   - 桌面端：8 个按钮平铺在 .sidebar-footer 里，#settingsBtn 直接可见。
 *   - 窄屏端：拆成 primary-row（主题/朋友圈/世界书/插件）与
 *     secondary-row（设置/导入/创建/创建群组，初始 display:none），
 *     整条侧栏本身还是抽屉式（`#sidebar { transform: translateX(-100%) }` 配 `.open`）。
 *
 * 所以窄屏下要点两次才够得着设置按钮：先开抽屉，再展开次级行。
 * 这里统一判断，让同一段用例在桌面与移动两个 project 下都能跑。
 */
async function openSettings(page) {
  const hamburger = page.locator('#mobileMenuToggle');
  if (await hamburger.isVisible()) {
    await hamburger.click();
  }

  const expandToggle = page.locator('#expandToggleBtn');
  if (await expandToggle.isVisible()) {
    await expandToggle.click();
  }

  await page.click('#settingsBtn');
  await expect(page.locator('#modalContent')).toContainText('情绪识别', { timeout: 15_000 });
}

/** 从设置弹窗进入情绪识别调试面板 */
async function openEmotionDebug(page) {
  await openSettings(page);
  await page.click('#emotionDebugBtn');
  await expect(page.locator('#emotionDebugInput')).toBeVisible({ timeout: 15_000 });
}

test.describe('情绪识别', () => {
  test('设置界面提供语义识别与 LLM 仲裁配置', async ({ page }) => {
    await bootApp(page);
    await openSettings(page);

    await expect(page.locator('#settingsEmotionSemanticMode')).toBeVisible();
    await expect(page.locator('#settingsEmotionLLMArbiter')).toBeAttached();

    const options = await page.locator('#settingsEmotionSemanticMode option').allTextContents();
    expect(options.join('|')).toContain('自动');
    expect(options.join('|')).toContain('总是启用');
  });

  test('调试面板可打开', async ({ page }) => {
    await bootApp(page);
    await openEmotionDebug(page);

    await expect(page.locator('#emotionDebugRun')).toBeVisible();
  });

  test('调试面板对「我不喜欢你」给出否定判定', async ({ page }) => {
    await bootApp(page);
    await openEmotionDebug(page);

    await page.fill('#emotionDebugInput', '我不喜欢你');
    await page.click('#emotionDebugRun');

    const output = page.locator('#emotionDebugOutput');
    await expect(output).toContainText('rejection', { timeout: 15_000 });
    // 必须落到「拒绝疏离」，而不是亲密
    await expect(output).not.toContainText('intimate（亲密）');
  });

  test('调试面板对「他喜欢你」给出第三方判定', async ({ page }) => {
    await bootApp(page);
    await openEmotionDebug(page);

    await page.fill('#emotionDebugInput', '他喜欢你');
    await page.click('#emotionDebugRun');

    const output = page.locator('#emotionDebugOutput');
    await expect(output).toContainText('rival_affection', { timeout: 15_000 });
  });

  test('快捷样例可一键试跑', async ({ page }) => {
    await bootApp(page);
    await openEmotionDebug(page);

    await page.click('.emotion-debug-sample[data-text="不爱你"]');

    const output = page.locator('#emotionDebugOutput');
    await expect(output).toContainText('rejection', { timeout: 15_000 });
  });

  test('调试面板展示子句切分明细', async ({ page }) => {
    await bootApp(page);
    await openEmotionDebug(page);

    await page.fill('#emotionDebugInput', '我喜欢你，但是我不爱你了');
    await page.click('#emotionDebugRun');

    const output = page.locator('#emotionDebugOutput');
    await expect(output).toContainText('子句切分与命中明细', { timeout: 15_000 });
    // 两个子句都应当被展示
    await expect(output).toContainText('我喜欢你');
    await expect(output).toContainText('我不爱你了');
  });
});
