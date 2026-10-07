import { test, expect } from '@playwright/test';
import { waitForWxStylesheet } from './helpers/wx-theme-ready.js';

/**
 * 微信主题 · 移动端群聊。
 *
 * 覆盖四件事：
 * 1. 群聊头像为方形圆角（消息内头像带内联 50%，须被主题 CSS 覆盖）
 * 2. 微信式消息布局：昵称与头像顶对齐、气泡在其右下方同列对齐、
 *    尾巴抬至头像中部，用户短消息不被压瘪
 * 3. 群名不带前缀图标
 * 4. 群聊对话页可被返回手势 / 返回键退回列表层，且能再次进入
 *    （返回后再点同一个群同样要能进入）
 *
 * 主题经 localStorage 预置；数据用应用自身的模块造（与 wechat-theme.spec.js
 * 同一套路），不走 UI 创建流程。
 */

const READY = () => Boolean(window.__utopiaReady);

async function openWithTheme(page, themeId) {
  await page.addInitScript((theme) => {
    localStorage.setItem('utopia-theme', theme);
  }, themeId);
  await page.goto('/');
  await page.waitForFunction(READY, null, { timeout: 30_000 });
  await waitForWxStylesheet(page);
}

/** 造一个角色 + 一个含该角色的群 + 一条群消息，并渲染群列表 */
async function seedGroup(page, groupName) {
  return page.evaluate(async (name) => {
    const { getAppState } = await import('/js/core/state.js');
    const { createCharacter } = await import('/js/modules/character.js');
    const { createGroup, addGroupMember } = await import('/js/modules/groupChat.js');
    const { getStores } = await import('/js/core/db.js');
    const { renderGroupList } = await import('/js/ui/screens/groupListUI.js');

    const chars = getAppState().get('characters') || [];
    let char = chars[0];
    if (!char) {
      char = await createCharacter({ name: '群成员角色', description: 'E2E 造数' }, { skipApiCheck: true });
    }

    const group = await createGroup(name);
    await addGroupMember(group.id, char.id, 'character', 'member');

    const stores = await getStores();
    await stores.group_messages.add({
      id: `seed-msg-${group.id}`,
      groupId: group.id,
      senderId: char.id,
      senderType: 'character',
      senderName: char.name,
      content: '这是一条用于布局断言的群消息',
      timestamp: Date.now(),
    });

    await renderGroupList();
    return { groupId: group.id, charId: char.id };
  }, groupName);
}

test.describe('微信主题 · 移动端群聊', () => {
  test.beforeEach(async ({ page }) => {
    test.skip(page.viewportSize().width > 768, '仅移动端视口');
  });

  test('群聊头像方形圆角 + 微信式消息布局 + 群名无前缀图标', async ({ page }) => {
    await openWithTheme(page, 'wechat');

    const { groupId } = await seedGroup(page, '布局验证群');
    // 用户短消息：容器为内容自适应宽度 + 40px 缩进时，短消息会被压成一字一行
    await page.evaluate(async (gid) => {
      const { getStores } = await import('/js/core/db.js');
      const stores = await getStores();
      await stores.group_messages.add({
        id: `seed-own-${gid}`,
        groupId: gid,
        senderId: 'user',
        senderType: 'user',
        senderName: '用户',
        content: '好的没问题',
        timestamp: Date.now(),
      });
    }, groupId);
    await page.evaluate(async (gid) => {
      const { openGroupChat } = await import('/js/ui/screens/groupChatUI.js');
      await openGroupChat(gid);
    }, groupId);
    await page.waitForTimeout(400);

    await expect(page.locator('body')).toHaveAttribute('data-wx-mobile-view', 'chat');

    // 群名不带任何前缀图标
    await expect(page.locator('#charName')).toHaveText('布局验证群');

    const layout = await page.evaluate(() => {
      const rect = (el) => el.getBoundingClientRect();
      const msg = document.querySelector('#chatMessages .group-message:not(.own)');
      const own = document.querySelector('#chatMessages .group-message.own .group-message-bubble');
      if (!msg) return null;
      const avatar = msg.querySelector('.avatar');
      const name = msg.querySelector('.sender-name');
      const bubble = msg.querySelector('.group-message-bubble');
      return {
        avatarRadius: avatar ? getComputedStyle(avatar).borderRadius : null,
        avatarBox: avatar ? rect(avatar).toJSON() : null,
        nameBox: name ? rect(name).toJSON() : null,
        bubbleBox: bubble ? rect(bubble).toJSON() : null,
        tailTop: bubble
          ? getComputedStyle(bubble, '::after').top
          : null,
        ownBubble: own
          ? { width: Math.round(rect(own).width), height: Math.round(rect(own).height) }
          : null,
      };
    });

    expect(layout).not.toBeNull();
    // 头像方形圆角（DOM 上是内联 50%，靠主题 CSS 的 !important 覆盖）
    expect(layout.avatarRadius).toBe('6px');
    // 昵称与头像顶对齐（高度齐平）
    expect(Math.abs(layout.nameBox.top - layout.avatarBox.top)).toBeLessThanOrEqual(2);
    // 气泡在昵称下方、头像右侧
    expect(layout.bubbleBox.top).toBeGreaterThanOrEqual(Math.round(layout.nameBox.bottom) - 1);
    expect(layout.bubbleBox.left).toBeGreaterThanOrEqual(Math.round(layout.avatarBox.right));
    // 气泡与昵称同列（左缘对齐）
    expect(Math.abs(layout.bubbleBox.left - layout.nameBox.left)).toBeLessThanOrEqual(1);
    // 尾巴贴在气泡顶边、随之抬到头像中部（单独上移会让尾巴脱离气泡边缘）
    expect(layout.tailTop).toBe('0px');
    // 气泡紧贴昵称下方：间距不超过 4px（昵称独占一行时气泡会下沉很远）
    expect(Math.round(layout.bubbleBox.top - layout.nameBox.bottom)).toBeLessThanOrEqual(2);
    // 用户短消息保持单行、内容自适应宽：不被百分比 max-width 压瘪
    // （例如「怎么了」被压成一字一行）。单行实测约 36px 高；2 行即 56px+。
    expect(layout.ownBubble).not.toBeNull();
    expect(layout.ownBubble.width).toBeGreaterThanOrEqual(60);
    expect(layout.ownBubble.height).toBeLessThan(45);
  });

  test('群聊对话页可返回列表层，且能再次进入同一群', async ({ page }) => {
    await openWithTheme(page, 'wechat');

    const { groupId } = await seedGroup(page, '往返验证群');

    // 第一次进入
    await page.evaluate(async (gid) => {
      const { openGroupChat } = await import('/js/ui/screens/groupChatUI.js');
      await openGroupChat(gid);
    }, groupId);
    await page.waitForTimeout(300);
    await expect(page.locator('body')).toHaveAttribute('data-wx-mobile-view', 'chat');

    // 返回手势 / 返回键 → 回列表层（不退出应用）
    await page.goBack();
    await page.waitForTimeout(300);
    await expect(page.locator('body')).toHaveAttribute('data-wx-mobile-view', 'list');

    // 再次点同一个群：state 同值若不通知订阅，就会「点了没反应」
    await page.locator(`.group-item[data-id="${groupId}"]`).click();
    await page.waitForTimeout(400);
    await expect(page.locator('body')).toHaveAttribute('data-wx-mobile-view', 'chat');
    await expect(page.locator('#charName')).toHaveText('往返验证群');
  });

  test('移动端列表卡片上的操作按钮退场（改由对话页 ··· 承载）', async ({ page }) => {
    await openWithTheme(page, 'wechat');

    const { groupId } = await seedGroup(page, '按钮退场群');
    await page.evaluate(async () => {
      const { renderCharacterList } = await import('/js/ui/screens/characterListUI.js');
      await renderCharacterList();
      const { setMobileView } = await import('/js/ui/layout/wechatTheme.js');
      setMobileView('list');
    }, groupId);
    await page.waitForTimeout(300);

    const groupBtn = page.locator(`.group-item[data-id="${groupId}"] .settings-btn`);
    await expect(groupBtn).toBeHidden();
    const charBtn = page.locator('#characterList .character-item:not(.group-item) .edit-btn').first();
    await expect(charBtn).toBeHidden();
  });

  test('对话页「···」菜单承载群设置等列表卡片操作', async ({ page }) => {
    await openWithTheme(page, 'wechat');

    const { groupId } = await seedGroup(page, '菜单验证群');
    await page.evaluate(async (gid) => {
      const { openGroupChat } = await import('/js/ui/screens/groupChatUI.js');
      await openGroupChat(gid);
    }, groupId);
    await page.waitForTimeout(300);

    const more = page.locator('#wxChatMoreBtn');
    await expect(more).toBeVisible();
    await expect(page.locator('#wxChatMoreMenu')).toBeHidden();

    await more.click();
    const menu = page.locator('#wxChatMoreMenu');
    await expect(menu).toBeVisible();
    await expect(menu.locator('.wx-menu-item')).toHaveText(['群设置']);
  });

  test('顶栏名称居中、无关系行；浅/深色尾巴都存在', async ({ page }) => {
    // 深色主题一并验证：形状声明若只写在 wechat 下，
    // 深色只覆盖颜色（缺 content），伪元素不存在、尾巴整条消失
    await openWithTheme(page, 'wechat-dark');

    const { groupId } = await seedGroup(page, '顶栏验证群');
    await page.evaluate(async (gid) => {
      const { getStores } = await import('/js/core/db.js');
      const stores = await getStores();
      await stores.group_messages.add({
        id: `seed-own-${gid}`,
        groupId: gid,
        senderId: 'user',
        senderType: 'user',
        senderName: '用户',
        content: '好的',
        timestamp: Date.now(),
      });
      const { openGroupChat } = await import('/js/ui/screens/groupChatUI.js');
      await openGroupChat(gid);
    }, groupId);
    await page.waitForTimeout(400);

    const ui = await page.evaluate(() => {
      const header = document.getElementById('chatHeader');
      const info = document.getElementById('characterInfo');
      const relation = document.getElementById('charRelation');
      const bubble = document.querySelector('#chatMessages .group-message:not(.own) .group-message-bubble');
      const own = document.querySelector('#chatMessages .group-message.own .group-message-bubble');
      const cs = (el, pseudo) => getComputedStyle(el, pseudo);
      const hr = header.getBoundingClientRect();
      const ir = info.getBoundingClientRect();
      const actions = document.querySelector('#chatHeader .header-actions');
      return {
        headerCenterOffset: Math.round(Math.abs((ir.left + ir.right) / 2 - hr.width / 2)),
        relationDisplay: relation ? getComputedStyle(relation).display : null,
        tail: bubble
          ? {
              content: cs(bubble, '::after').content,
              top: cs(bubble, '::after').top,
              color: cs(bubble, '::after').borderRightColor,
            }
          : null,
        ownTailColor: own ? cs(own, '::after').borderLeftColor : null,
        actionsRight: actions ? Math.round(actions.getBoundingClientRect().right) : null,
      };
    });

    // 名称横向居中（相对整条顶栏，偏差 ≤4px）
    expect(ui.headerCenterOffset).toBeLessThanOrEqual(4);
    // 人物关系 / 群人数已移除
    expect(ui.relationDisplay).toBe('none');
    // 「···」仍在右上角
    expect(ui.actionsRight).toBeGreaterThanOrEqual(340);
    // 深色下对方气泡尾巴存在（content 非空）且贴顶边、深灰
    expect(ui.tail).not.toBeNull();
    expect(ui.tail.content).toBe('""');
    expect(ui.tail.top).toBe('0px');
    expect(ui.tail.color).toBe('rgb(44, 44, 44)');
    // 深色下用户气泡尾巴为深绿
    expect(ui.ownTailColor).toBe('rgb(62, 181, 117)');
    void groupId;
  });
});
