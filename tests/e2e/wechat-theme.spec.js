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

    // 侧栏 footer 重排为最左垂直图标栏（64px 宽）
    const footerBox = await page.locator('.sidebar-footer').boundingBox();
    expect(footerBox.x).toBeLessThan(8);
    expect(footerBox.width).toBeGreaterThanOrEqual(60);
    expect(footerBox.width).toBeLessThan(72);

    // 列表列让出图标栏宽度
    const sidebarBox = await page.locator('#sidebar').boundingBox();
    expect(sidebarBox.x).toBeGreaterThanOrEqual(56);

    // 头像方形圆角（默认主题下是全圆）
    const radius = await page.evaluate(() =>
      getComputedStyle(document.getElementById('charAvatar')).borderRadius
    );
    expect(radius).toBe('6px');

    // 聊天顶栏不显示头像，只留名称
    await expect(page.locator('#charAvatar')).toBeHidden();
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

  test('输入区微信化：工具行在上、输入区加高、发送为右下角文字按钮', async ({ page }) => {
    await openWithTheme(page, 'wechat');

    // 打开对话区，输入区才有布局
    await page.evaluate(() => {
      document.getElementById('welcomePage').style.display = 'none';
      const chat = document.getElementById('chatContainer');
      chat.style.display = 'flex';
    });

    const info = await page.evaluate(() => {
      const input = document.getElementById('chatInput');
      const send = document.getElementById('sendBtn');
      const box = input.getBoundingClientRect();
      const sendBox = send.getBoundingClientRect();
      return {
        minHeight: getComputedStyle(input).minHeight,
        inputBg: getComputedStyle(input).backgroundColor,
        // 聊天页底色由 #chatMessages 绘制（--color-bg-secondary）
        chatBg: getComputedStyle(document.getElementById('chatMessages')).backgroundColor,
        // 输入区外围边缘留白露出 #main，须与聊天页同色（不留浅色缝）
        mainBg: getComputedStyle(document.getElementById('main')).backgroundColor,
        // 输入框本体比外围容器亮一档（--color-bg-input）
        textareaBg: getComputedStyle(document.getElementById('messageInput')).backgroundColor,
        sendLabel: getComputedStyle(send, '::after').content,
        sendRadius: getComputedStyle(send).borderRadius,
        sendWidth: sendBox.width,
        sendRightGap: box.right - sendBox.right,
        sendBottomGap: box.bottom - sendBox.bottom,
      };
    });
    expect(parseFloat(info.minHeight)).toBeGreaterThanOrEqual(150);
    // 输入区与聊天页同底色（--color-bg-secondary，浅色微信下 #ededed）
    expect(info.inputBg).toBe(info.chatBg);
    expect(info.inputBg).toBe('rgb(237, 237, 237)');
    // 外围留白与聊天页同色，输入框本体略亮（#ffffff）
    expect(info.mainBg).toBe(info.chatBg);
    expect(info.textareaBg).toBe('rgb(255, 255, 255)');
    expect(info.textareaBg).not.toBe(info.inputBg);
    expect(info.sendLabel).toBe('"发送"');
    expect(info.sendRadius).toBe('4px');
    expect(info.sendWidth).toBeGreaterThan(50);
    // 发送按钮贴输入区右下角
    expect(info.sendRightGap).toBeLessThan(20);
    expect(info.sendBottomGap).toBeLessThan(14);
  });

  test('输入区麦克风按钮在发送按钮左侧且同行', async ({ page }) => {
    await openWithTheme(page, 'wechat');

    await page.evaluate(() => {
      document.getElementById('welcomePage').style.display = 'none';
      document.getElementById('chatContainer').style.display = 'flex';
    });

    const pos = await page.evaluate(() => {
      const mic = document.querySelector('#chatInput .mic-btn');
      const send = document.getElementById('sendBtn');
      if (!mic || !send) return null;
      const m = mic.getBoundingClientRect();
      const s = send.getBoundingClientRect();
      return { micRight: m.right, sendLeft: s.left, micBottom: m.bottom, sendBottom: s.bottom };
    });
    expect(pos).not.toBeNull();
    // 与发送按钮同一行（底边对齐），且紧贴其左侧
    expect(Math.abs(pos.micBottom - pos.sendBottom)).toBeLessThan(6);
    expect(pos.sendLeft - pos.micRight).toBeGreaterThanOrEqual(-2);
    expect(pos.sendLeft - pos.micRight).toBeLessThan(30);
  });

  test('朋友圈 PC 悬浮窗：定宽标题居中 + 圆角 + 内部整页滚动', async ({ page }) => {
    await openWithTheme(page, 'wechat');

    // 多铺几条动态，保证可滚动
    await page.evaluate(async () => {
      const social = await import('/js/modules/social.js');
      for (let i = 0; i < 6; i++) {
        await social.publishPostByUser({ id: 'user', name: '我' }, `滚动测试动态 ${i + 1}`);
      }
    });

    await page.locator('#socialBtn').click();
    await expect(page.locator('#modalOverlay')).toBeVisible();
    await page.waitForTimeout(450);

    // PC 为居中悬浮窗：520px 定宽、圆角 12px，明显小于视口（非全屏页面）
    const box = await page.locator('#modalContent').boundingBox();
    const vp = page.viewportSize();
    expect(box.width).toBeGreaterThanOrEqual(500);
    expect(box.width).toBeLessThanOrEqual(530);
    expect(box.height).toBeLessThanOrEqual(vp.height - 60);
    // 水平居中
    expect(Math.abs(box.x + box.width / 2 - vp.width / 2)).toBeLessThan(4);

    const shape = await page.evaluate(() => {
      const mc = document.getElementById('modalContent');
      const cs = getComputedStyle(mc);
      return { radius: cs.borderRadius, overflowY: cs.overflowY, shadow: cs.boxShadow };
    });
    expect(shape.radius).toBe('12px');
    expect(shape.overflowY).toBe('auto');
    expect(shape.shadow).toContain('rgba');

    const cover = page.locator('.wx-social-cover');
    await expect(cover).toBeVisible();
    await expect(cover.locator('.wx-cover-back')).toBeVisible();
    await expect(page.locator('#socialCloseBtn')).toBeHidden();

    // 整页滚动：滚动发生在模态本身，帖子列表不再内部滚动
    const scroll = await page.evaluate(() => {
      const mc = document.getElementById('modalContent');
      const posts = mc.querySelector('.social-posts');
      mc.scrollTop = 200;
      return {
        scrollTop: mc.scrollTop,
        scrollable: mc.scrollHeight > mc.clientHeight,
        postsOverflow: getComputedStyle(posts).overflowY,
      };
    });
    expect(scroll.scrollable).toBe(true);
    expect(scroll.scrollTop).toBeGreaterThan(100);
    expect(scroll.postsOverflow).toBe('visible');

    // 返回 → 关闭悬浮窗
    await page.locator('.wx-cover-back').click();
    await expect(page.locator('#modalOverlay')).toBeHidden();
  });

  // 回归：朋友圈布局曾被微信主题的封面注入 / 页面化样式污染，
  // 非微信主题必须保持 social.css 原生模态。
  for (const themeId of ['light', 'dark', 'cyberpunk']) {
    test(`非微信主题（${themeId}）朋友圈保持原生模态布局`, async ({ page }) => {
      await openWithTheme(page, themeId);

      await page.evaluate(async () => {
        const social = await import('/js/modules/social.js');
        await social.publishPostByUser({ id: 'user', name: '我' }, '原生主题动态');
      });

      await page.locator('#socialBtn').click();
      await expect(page.locator('#modalOverlay')).toBeVisible();
      await page.waitForTimeout(450);

      // 不注入任何微信封面元素，原生关闭按钮保留
      expect(await page.locator('.wx-social-cover').count()).toBe(0);
      expect(await page.locator('#modalContent .wx-cover-back').count()).toBe(0);
      await expect(page.locator('#socialCloseBtn')).toBeVisible();

      // 原生 .social-feed 自身限高滚动（微信主题的 520px 悬浮窗样式未生效）
      const feed = await page.evaluate(() => {
        const el = document.getElementById('modalContent').querySelector('.social-feed');
        const cs = getComputedStyle(el);
        return {
          overflowY: cs.overflowY,
          radius: getComputedStyle(document.getElementById('modalContent')).borderRadius,
          posts: el.querySelectorAll('.social-post').length,
        };
      });
      expect(feed.overflowY).toBe('auto');
      expect(feed.posts).toBeGreaterThanOrEqual(1);
      expect(feed.radius).not.toBe('12px');

      // 模态整体落在视口内，无横向溢出
      const layout = await page.evaluate(() => {
        const b = document.getElementById('modalContent').getBoundingClientRect();
        return {
          left: b.left,
          right: b.right,
          width: b.width,
          height: b.height,
          docOverflowX: document.documentElement.scrollWidth > window.innerWidth + 1,
        };
      });
      expect(layout.left).toBeGreaterThanOrEqual(0);
      expect(layout.right).toBeLessThanOrEqual(page.viewportSize().width + 1);
      expect(layout.width).toBeGreaterThan(200);
      expect(layout.height).toBeGreaterThan(100);
      expect(layout.docOverflowX).toBe(false);
    });
  }
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

  test('朋友圈为页面模式：全屏 + 封面 + 背景上传入口 + 返回', async ({ page }) => {
    await openWithTheme(page, 'wechat');

    await page.locator('#socialBtn').click();
    await expect(page.locator('#modalOverlay')).toBeVisible();

    // 页面化：模态变全屏（等打开动画结束再测量）
    await page.waitForTimeout(450);
    const box = await page.locator('#modalContent').boundingBox();
    const vp = page.viewportSize();
    expect(box.width).toBeGreaterThanOrEqual(vp.width - 20);
    expect(box.height).toBeGreaterThanOrEqual(vp.height - 20);

    // 封面注入：背景 / 相机上传入口 / 返回按钮 / 用户昵称
    const cover = page.locator('.wx-social-cover');
    await expect(cover).toBeVisible();
    await expect(cover.locator('.wx-cover-camera')).toBeVisible();
    await expect(cover.locator('.wx-cover-upload-input')).toHaveCount(1);
    await expect(cover.locator('.wx-cover-back')).toBeVisible();

    const meName = await cover.locator('.wx-me-name').textContent();
    expect(meName.length).toBeGreaterThan(0);

    // 原有关闭按钮（×）退场
    await expect(page.locator('#socialCloseBtn')).toBeHidden();

    // 返回 → 关闭页面
    await cover.locator('.wx-cover-back').click();
    await expect(page.locator('#modalOverlay')).toBeHidden();
  });
});
