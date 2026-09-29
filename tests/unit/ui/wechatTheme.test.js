import { describe, test, expect, beforeEach } from 'vitest';
import {
  isWechatTheme,
  setMobileView,
  currentMobileView,
} from '../../../js/ui/layout/wechatTheme.js';

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
