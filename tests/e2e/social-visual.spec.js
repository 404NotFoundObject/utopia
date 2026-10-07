/**
 * 朋友圈头部视觉一致性（微信主题）。
 *
 * 用户反馈：头部「🌐 朋友圈」标题行去掉后，剩余区域的背景色
 * 必须与帖子背景一致（透明会露出 feed 灰底，与白底帖子割裂；
 * feed/posts/发布框容器背景统一为帖子同色）。
 * 头部背景与帖子一致、标题与图标已移除，是朋友圈视觉层职责。
 * wechat.css 按需注入 + 排序于 titlebar.css 之前的断言归属主题层
 * （wechat-theme.spec.js），本文件不重复。
 */
import { test, expect } from '@playwright/test';
import { waitForWxStylesheet } from './helpers/wx-theme-ready.js';

test.describe('朋友圈头部视觉（微信主题）', () => {
  /** 注入一条用户帖子，保证有 .social-post 可供背景对比 */
  async function seedPost(page) {
    await page.evaluate(async () => {
      const db = await new Promise((res, rej) => {
        const req = indexedDB.open('UtopiaDB');
        req.onsuccess = () => res(req.result);
        req.onerror = () => rej(req.error);
      });
      await new Promise((res, rej) => {
        const req = db.transaction('posts', 'readwrite').objectStore('posts').put({
          id: 'e2e-visual-post',
          authorType: 'user',
          authorId: 'user',
          content: '视觉验证用帖子',
          images: [],
          likes: [],
          timestamp: Date.now() - 60_000,
          comments: [],
          replies: [],
        });
        req.onsuccess = () => res(null);
        req.onerror = () => rej(req.error);
      });
    });
  }

  test('头部背景与帖子一致，标题与图标已移除，样式表按需注入', async ({ page }) => {
    await page.goto('/');
    await page.waitForFunction(() => window.__utopiaReady === true, null, { timeout: 30_000 });

    await seedPost(page);

    // 切到微信主题：走应用的 applyTheme（会 emit theme:changed 驱动皮肤注入）
    await page.evaluate(async () => {
      const { applyTheme } = await import('./js/ui/layout/theme.js');
      applyTheme('wechat');
    });
    await expect(page.locator('html[data-theme="wechat"]')).toHaveCount(1);
    await waitForWxStylesheet(page);

    // 打开朋友圈
    await page.locator('#socialBtn').click();
    const feed = page.locator('.social-feed');
    await expect(feed).toBeVisible();

    // 微信主题下 social-header 整体退场（顶栏功能由 .wx-cover-topbar 承担）：
    // 相机按钮 = 发表动态，发布按钮本体隐藏但监听保留（相机转发其 click）
    await expect(feed.locator('.social-header')).toBeHidden();
    await expect(feed.locator('#socialTogglePublishBtn')).toBeHidden();
    await expect(feed.locator('.wx-cover-topbar .wx-cover-camera')).toBeVisible();

    // 帖子列表区背景必须与帖子一致（computed style 实测，非静态断言）。
    // posts 容器在帖子未填满时露出底色，漏覆盖就是截图里那块灰色空白。
    // 主题切换带 250ms 全站渐变（main.css 的 * 通用 transition），
    // 固定等待可能采样到中间值，这里轮询到两值一致（= 过渡收敛）。
    const readColors = () => page.evaluate(() => {
      const bg = (sel) => {
        const el = document.querySelector(sel);
        return el ? getComputedStyle(el).backgroundColor : null;
      };
      return { posts: bg('.social-posts'), post: bg('.social-post') };
    });
    const allMatch = (colors) =>
      colors.posts !== null && colors.post !== null && colors.posts === colors.post;
    await expect.poll(async () => allMatch(await readColors()), { timeout: 5_000 }).toBe(true);

    // 深色微信主题同样一致：保持模态打开直接切主题（observer 会补齐封面）
    await page.evaluate(async () => {
      const { applyTheme } = await import('./js/ui/layout/theme.js');
      applyTheme('wechat-dark');
    });
    await expect(page.locator('html[data-theme="wechat-dark"]')).toHaveCount(1);
    await expect.poll(async () => allMatch(await readColors()), { timeout: 5_000 }).toBe(true);

    // 收敛后采样一次，作为失败时的可读输出
    const darkColors = await readColors();
    expect(darkColors.posts).toBe(darkColors.post);
  });
});
