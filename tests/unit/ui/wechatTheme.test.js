import { describe, test, expect, beforeEach } from 'vitest';
import {
  isWechatTheme,
  setMobileView,
  currentMobileView,
  ensureInjectedNodes,
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
