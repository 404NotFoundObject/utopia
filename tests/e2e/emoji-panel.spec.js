import { test, expect } from '@playwright/test';

/**
 * Emoji 托盘的移动端焦点治理。
 *
 * 症状（真机）：托盘展开后点输入框，托盘收了但输入法没起来，必须再点一次才能打字。
 * 成因：移动端托盘是流式占位（42vh），document 的 mousedown 捕获监听在浏览器完成
 * 这次点击的聚焦默认行为之前就把面板 hidden 掉 —— 布局回流把输入栏挪走，
 * 这一次点击的 focus 就此落空。
 *
 * 这里用 touch tap（Pixel 5: hasTouch）复刻真实交互链路。
 *
 * ⚠️ headless 的边界：桌面/headless Chromium 把 focus 当作 mousedown 的默认动作执行，
 * 且不做「按坐标重新命中测试」，所以即便先收面板引起回流，最终 activeElement 依然正确 ——
 * 只断言「点完以后焦点在不在输入框」，在本环境里修复前后都会通过（已验证）。
 * 真机才会暴露原症状：移动端的 focus 被推迟到点击序列末尾并附带命中测试，
 * 那时输入栏已经被掀过一轮。因此下面的断言抓的是**焦点落定的时机**而非最终结果，
 * 这条用例已经通过「撤掉修复即失败」的反向验证，不是一条恒真用例。
 */

const READY = () => Boolean(window.__utopiaReady);

test.describe('Emoji 托盘 · 移动端焦点', () => {
  test.beforeEach(async ({ page }) => {
    test.skip(page.viewportSize().width > 768, '仅移动端视口');
    await page.goto('/');
    await page.waitForFunction(READY, null, { timeout: 30_000 });
    // 进入对话层（输入栏在移动端对话页才有实际几何）
    await page.evaluate(async () => {
      document.getElementById('welcomePage').style.display = 'none';
      document.getElementById('chatContainer').style.display = 'flex';
      const { ensureEmojiButton } = await import('/js/ui/components/emojiPicker.js');
      ensureEmojiButton();
    });
    await page.waitForTimeout(200);
  });

  test('托盘展开后点输入框：一次点击即收起，且焦点落在输入框', async ({ page }) => {
    await page.locator('#emojiBtn').tap();
    await expect(page.locator('#emojiPanel')).toBeVisible();

    // 前提校验：移动端托盘必须是流式占位的大块高度（否则这条用例测不到回流场景）
    const panel = await page.evaluate(() => {
      const p = document.getElementById('emojiPanel');
      const r = p.getBoundingClientRect();
      return { hidden: p.hidden, mobile: p.classList.contains('mobile'), height: Math.round(r.height) };
    });
    expect(panel.hidden).toBe(false);
    expect(panel.mobile).toBe(true);
    expect(panel.height).toBeGreaterThan(120);

    // 关键契约：焦点必须在「浏览器默认聚焦动作」之前落定。
    //
    // 桌面 Chromium 把 focus 作为 mousedown 的默认动作执行（在所有监听器跑完之后），
    // 因此单看 activeElement 的最终值，headless 里无论修复与否都是对的 —— 抓不住 bug。
    // 移动端实现则不同：focus 被推迟到点击序列末尾并附带命中测试，而那时面板收起
    // 引起的回流已经把输入栏挪走了。所以这里抓的是**落定时机**：在 textarea 自己的
    // mousedown 监听器里（document 捕获阶段之后、默认动作之前）焦点必须已经是输入框。
    const focusProbe = page.evaluate(
      () =>
        new Promise((resolve) => {
          const input = document.getElementById('messageInput');
          const onDown = () => resolve(document.activeElement?.id ?? null);
          input.addEventListener('mousedown', onDown);
          setTimeout(() => {
            input.removeEventListener('mousedown', onDown);
            resolve(null);
          }, 3000);
        })
    );

    // 关键行为：一次 tap 要同时完成「收托盘」与「拿焦点」
    await page.locator('#messageInput').tap();

    expect(await focusProbe).toBe('messageInput');

    const after = await page.evaluate(() => ({
      hidden: document.getElementById('emojiPanel').hidden,
      activeId: document.activeElement?.id,
    }));
    expect(after.hidden).toBe(true);
    expect(after.activeId).toBe('messageInput');

    // 焦点真的可用：不用再点一次就能输入
    await page.keyboard.type('在吗');
    await expect(page.locator('#messageInput')).toHaveValue('在吗');
  });

  test('托盘展开时点表情：写入文本但不起输入法（托盘与键盘互斥）', async ({ page }) => {
    const input = page.locator('#messageInput');
    await input.tap();
    await expect(input).toBeFocused();

    await page.locator('#emojiBtn').tap();
    await expect(page.locator('#emojiPanel')).toBeVisible();

    // 开托盘应收起焦点
    await expect
      .poll(() => page.evaluate(() => document.activeElement?.id))
      .not.toBe('messageInput');

    const cell = page.locator('#emojiPanel [data-grid="all"] .emoji-cell').first();
    const emoji = (await cell.textContent())?.trim();
    await cell.tap();

    await expect(input).toHaveValue(emoji);
    // 仍然不抢焦点：连点多个表情时键盘不会被反复拉起
    await expect
      .poll(() => page.evaluate(() => document.activeElement?.id))
      .not.toBe('messageInput');

    // 关闭托盘后再点输入框，仍应一次到位
    await input.tap();
    await expect(input).toBeFocused();
  });
});
