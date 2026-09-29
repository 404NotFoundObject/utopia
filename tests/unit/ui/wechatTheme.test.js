import { describe, test, expect, beforeEach } from 'vitest';
import {
  isWechatTheme,
  setMobileView,
  currentMobileView,
  ensureInjectedNodes,
  ensureSocialCover,
} from '../../../js/ui/layout/wechatTheme.js';
import { getAppState } from '../../../js/core/state.js';

/**
 * 微信主题移动端视图状态机的纯逻辑检查。
 * CSS 侧（列表层 / 对话页 / dock）由 E2E 覆盖，这里验证
 * data-wx-mobile-view 的写入与清理规则。
 */
describe('wechatTheme 视图状态', () => {
  beforeEach(() => {
    document.documentElement.removeAttribute('data-theme');
    delete document.body.dataset.wxMobileView;
  });

  test('isWechatTheme 识别两种微信主题，不误判其他主题', () => {
    document.documentElement.setAttribute('data-theme', 'wechat');
    expect(isWechatTheme()).toBe(true);

    document.documentElement.setAttribute('data-theme', 'wechat-dark');
    expect(isWechatTheme()).toBe(true);

    document.documentElement.setAttribute('data-theme', 'light');
    expect(isWechatTheme()).toBe(false);

    document.documentElement.setAttribute('data-theme', 'dark');
    expect(isWechatTheme()).toBe(false);
  });

  test('setMobileView 只接受 list / chat', () => {
    setMobileView('chat');
    expect(currentMobileView()).toBe('chat');

    setMobileView('list');
    expect(currentMobileView()).toBe('list');

    setMobileView('bogus');
    expect(currentMobileView()).toBe('list');
  });

  test('未设置时默认返回 list（与 CSS 降级行为一致）', () => {
    expect(currentMobileView()).toBe('list');
  });
});

describe('wechatTheme 注入节点', () => {
  // resetDom 只清内容容器，注入进 sidebar-footer/header 的节点需手动移除，
  // 否则下一用例的幂等注入会因 id 已存在而短路。
  const INJECTED_IDS = ['wxBackBtn', 'wxDockChatBtn', 'wxUserAvatar', 'wxPlusBtn', 'wxPlusMenu'];
  beforeEach(() => {
    for (const id of INJECTED_IDS) document.getElementById(id)?.remove();
  });

  test('注入聊天按钮 / 用户头像 / + 按钮与菜单，且幂等', () => {
    ensureInjectedNodes();

    const chatBtn = document.getElementById('wxDockChatBtn');
    expect(chatBtn).not.toBeNull();
    expect(chatBtn.classList.contains('sidebar-btn')).toBe(true);

    const avatar = document.getElementById('wxUserAvatar');
    expect(avatar).not.toBeNull();
    expect(avatar.src.startsWith('data:image/svg+xml')).toBe(true);

    const plus = document.getElementById('wxPlusBtn');
    const menu = document.getElementById('wxPlusMenu');
    expect(plus?.parentElement.classList.contains('sidebar-header')).toBe(true);
    expect(menu?.querySelectorAll('.wx-menu-item').length).toBe(5);

    ensureInjectedNodes();
    expect(document.querySelectorAll('#wxPlusMenu').length).toBe(1);
    expect(document.querySelectorAll('#wxDockChatBtn').length).toBe(1);
  });

  test('+ 菜单项点击转发给 footer 内对应按钮并收起菜单', () => {
    ensureInjectedNodes();

    const received = [];
    const stub = document.createElement('button');
    stub.id = 'importBtn';
    stub.addEventListener('click', () => received.push('import'));
    document.querySelector('#sidebar .sidebar-footer').appendChild(stub);

    const entry = [...document.querySelectorAll('#wxPlusMenu .wx-menu-item')]
      .find((el) => el.textContent.includes('导入角色'));
    entry.click();

    expect(received).toEqual(['import']);
    expect(document.getElementById('wxPlusMenu').classList.contains('open')).toBe(false);
  });

  test('settings.user.avatar 变化反映到注入的头像元素', () => {
    const state = getAppState();
    state.set('settings', { user: { avatar: 'data:image/png;base64,AAA' } });
    ensureInjectedNodes();
    expect(document.getElementById('wxUserAvatar').src).toContain('data:image/png;base64,AAA');
  });
});

describe('朋友圈页面化封面', () => {
  const INJECTED_IDS = ['wxBackBtn', 'wxDockChatBtn', 'wxUserAvatar', 'wxPlusBtn', 'wxPlusMenu'];
  beforeEach(() => {
    for (const id of INJECTED_IDS) document.getElementById(id)?.remove();
    localStorage.removeItem('utopia:wx-social-cover');
    // 封面仅微信主题注入，默认置于微信主题上下文
    document.documentElement.setAttribute('data-theme', 'wechat');
  });

  /** 在模态内容里放置一个最小 .social-feed 结构 */
  function mountFeed() {
    const feed = document.createElement('div');
    feed.className = 'social-feed';
    document.getElementById('modalContent').appendChild(feed);
    return feed;
  }

  test('注入封面：返回 / 相机 / 上传入口 / 头像昵称，且幂等', () => {
    const state = getAppState();
    state.set('settings', { user: { name: '阿澈', avatar: 'data:image/png;base64,ME' } });
    const feed = mountFeed();

    ensureSocialCover();

    const cover = feed.querySelector('.wx-social-cover');
    expect(cover).not.toBeNull();
    expect(cover.querySelector('.wx-cover-back')).not.toBeNull();
    expect(cover.querySelector('.wx-cover-camera')).not.toBeNull();
    expect(cover.querySelector('.wx-cover-upload-input')?.type).toBe('file');
    expect(cover.querySelector('.wx-me-name').textContent).toBe('阿澈');
    expect(cover.querySelector('.wx-social-me img').src).toContain('base64,ME');
    // 无已保存背景时不渲染背景 img
    expect(cover.querySelector('.wx-cover-img')).toBeNull();

    ensureSocialCover();
    expect(feed.querySelectorAll('.wx-social-cover').length).toBe(1);
  });

  test('已保存背景时封面渲染背景图', () => {
    localStorage.setItem('utopia:wx-social-cover', 'data:image/jpeg;base64,COVER');
    const feed = mountFeed();

    ensureSocialCover();

    const bg = feed.querySelector('.wx-cover-img');
    expect(bg).not.toBeNull();
    expect(bg.src).toContain('base64,COVER');
  });

  test('返回按钮关闭模态', async () => {
    const feed = mountFeed();
    ensureSocialCover();
    // overlay 处于打开态
    const overlay = document.getElementById('modalOverlay');
    overlay.classList.remove('hidden');

    feed.querySelector('.wx-cover-back').click();
    await new Promise((r) => setTimeout(r, 0));
    expect(overlay.classList.contains('hidden')).toBe(true);
  });

  test('非微信主题不注入封面，并清除切换前留下的残留', () => {
    // 模拟从微信主题切到亮色主题：残留旧封面 + social-feed 仍在模态中
    document.documentElement.setAttribute('data-theme', 'light');
    const feed = mountFeed();
    const stale = document.createElement('div');
    stale.className = 'wx-social-cover';
    feed.appendChild(stale);

    ensureSocialCover();

    expect(feed.querySelector('.wx-social-cover')).toBeNull();

    // 暗色 / 赛博朋克等非微信主题同样不注入
    document.documentElement.setAttribute('data-theme', 'dark');
    ensureSocialCover();
    expect(feed.querySelector('.wx-social-cover')).toBeNull();
  });
});
