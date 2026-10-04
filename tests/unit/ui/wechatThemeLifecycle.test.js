import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import {
  activateWechatTheme,
  deactivateWechatTheme,
  syncWechatTheme,
  ensureInjectedNodes,
} from '../../../js/ui/layout/wechatTheme.js';
import { getAppState } from '../../../js/core/state.js';

/**
 * 皮肤生命周期对称性。
 *
 * 注入节点有 css/wechat.css 的全局 display:none 兜底，所以「切回去不收拾」
 * 不会露出视觉问题，真正的代价是滞留的 DOM 与**永不回收的副作用**：
 * MutationObserver、三个 state 订阅、resize / click / scroll 监听。
 * 这里逐条锁住「停用后必须干净」。
 */
describe('wechatTheme 皮肤生命周期', () => {
  const INJECTED_IDS = ['wxBackBtn', 'wxDockChatBtn', 'wxUserAvatar', 'wxPlusBtn', 'wxPlusMenu'];
  const state = getAppState();

  function setTheme(theme) {
    if (theme) document.documentElement.setAttribute('data-theme', theme);
    else document.documentElement.removeAttribute('data-theme');
  }

  /** 把 window.innerWidth 临时改写为移动端宽度 */
  function setViewportWidth(width) {
    Object.defineProperty(window, 'innerWidth', { value: width, configurable: true });
  }

  beforeEach(async () => {
    setTheme('wechat');
    for (const id of INJECTED_IDS) document.getElementById(id)?.remove();
  });

  afterEach(async () => {
    // 无论用例如何收场，都把皮肤收回停用态，避免泄漏到后续测试文件
    setTheme('light');
    await syncWechatTheme();
    for (const id of INJECTED_IDS) document.getElementById(id)?.remove();
    delete document.body.dataset.wxMobileView;
  });

  test('停用后注入节点全部移除，不留任何 wx 前缀根节点', async () => {
    await activateWechatTheme();
    for (const id of INJECTED_IDS) {
      expect(document.getElementById(id), `${id} 应在激活时存在`).not.toBeNull();
    }

    deactivateWechatTheme();
    for (const id of INJECTED_IDS) {
      expect(document.getElementById(id), `${id} 应在停用后移除`).toBeNull();
    }
  });

  test('停用后退订 state 订阅：改头像不再回写已失效的 DOM', async () => {
    await activateWechatTheme();
    state.set('settings', { user: { avatar: 'data:image/png;base64,OLD' } });
    expect(document.getElementById('wxUserAvatar').src).toContain('base64,OLD');

    deactivateWechatTheme();

    // 重新放一个同名节点进去（等价于别处又调了一次 ensureInjectedNodes）
    ensureInjectedNodes();
    const avatar = document.getElementById('wxUserAvatar');
    expect(avatar).not.toBeNull();

    state.set('settings', { user: { avatar: 'data:image/png;base64,NEW' } });
    expect(avatar.src, '停用后订阅应已退订，不再回写').not.toContain('base64,NEW');
  });

  test('停用后 MutationObserver 不再补注入', async () => {
    await activateWechatTheme();
    deactivateWechatTheme();

    // 触发 sidebar 子树变动： observer 的补齐是 100ms 延迟调度
    const footer = document.querySelector('#sidebar .sidebar-footer');
    footer.appendChild(document.createElement('span'));

    await new Promise((r) => setTimeout(r, 200));
    for (const id of INJECTED_IDS) {
      expect(document.getElementById(id), `${id} 不应被已停用的 observer 补回来`).toBeNull();
    }
  });

  test('停用后 resize 不再驱动视图状态', async () => {
    setViewportWidth(400);
    await activateWechatTheme();
    expect(document.body.dataset.wxMobileView).toBe('list');

    // 先清掉，若 resize 监听仍在，它会把视图重新算回 list
    delete document.body.dataset.wxMobileView;
    deactivateWechatTheme();
    window.dispatchEvent(new Event('resize'));

    expect(document.body.dataset.wxMobileView, '停用后不应再响应 resize').toBeUndefined();
  });

  test('theme:changed 驱动的来回切换不留残留', async () => {
    await syncWechatTheme();
    expect(document.getElementById('wxPlusBtn')).not.toBeNull();

    setTheme('dark');
    await syncWechatTheme();
    expect(document.getElementById('wxPlusBtn')).toBeNull();

    setTheme('wechat-dark');
    await syncWechatTheme();
    expect(document.getElementById('wxPlusBtn')).not.toBeNull();

    setTheme('light');
    await syncWechatTheme();
    expect(document.getElementById('wxPlusBtn')).toBeNull();
  });

  test('activate / deactivate 幂等，重复调用不重复注入', async () => {
    await activateWechatTheme();
    await activateWechatTheme();
    expect(document.querySelectorAll('#wxPlusMenu').length).toBe(1);
    expect(document.querySelectorAll('#wxPlusBtn').length).toBe(1);

    deactivateWechatTheme();
    deactivateWechatTheme();
    expect(document.querySelectorAll('#wxPlusMenu').length).toBe(0);
  });

  test('重复切换多次后 disposers 不累积（订阅不会成倍增长）', async () => {
    for (let i = 0; i < 5; i += 1) {
      setTheme(i % 2 === 0 ? 'wechat' : 'light');
      await syncWechatTheme();
    }
    setTheme('wechat');
    await syncWechatTheme();

    ensureInjectedNodes();
    const avatar = document.getElementById('wxUserAvatar');
    state.set('settings', { user: { avatar: 'data:image/png;base64,ONCE' } });
    // 头像回写应当是「一次更新」而非五次重复写入：这里用最终值判断，
    // 若订阅重复注册，同一元素会被回写多次但值仍相同，改由 DOM 数量与
    // 「停用后立即失效」两条断言共同约束（见上一个用例）。

    // 停用后立刻切断回写 —— 若历次 activate 的订阅有残留，这一条会失败
    setTheme('light');
    await syncWechatTheme();
    ensureInjectedNodes();
    state.set('settings', { user: { avatar: 'data:image/png;base64,AFTER' } });
    expect(document.getElementById('wxUserAvatar').src).not.toContain('base64,AFTER');
    expect(avatar.tagName).toBe('IMG');
  });

  // ----- 样式表按需加载 -----
  // wechat.css 不再常驻 index.html，激活时注入、停用时移除；
  // 注入点必须在 titlebar.css 之前（窗口装饰器依赖加载顺序覆盖 wechat 变量）。

  function setupTitlebarLink() {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = 'css/titlebar.css';
    document.head.appendChild(link);
    return link;
  }

  test('激活时注入 wechat.css 且位于 titlebar.css 之前', async () => {
    const titlebar = setupTitlebarLink();
    await activateWechatTheme();

    const wx = document.querySelector('link[data-wx-stylesheet]');
    expect(wx, '激活后应存在按需注入的样式表').not.toBeNull();
    expect(wx.getAttribute('href')).toBe('css/wechat.css');
    expect(
      Array.from(document.head.children).indexOf(wx),
      'wechat.css 必须排在 titlebar.css 之前，否则覆盖顺序反转',
    ).toBeLessThan(Array.from(document.head.children).indexOf(titlebar));

    setTheme('light');
    await syncWechatTheme();
    titlebar.remove();
  });

  test('停用后样式表移除；再次激活重新注入且不重复', async () => {
    setupTitlebarLink();
    await activateWechatTheme();
    expect(document.querySelectorAll('link[data-wx-stylesheet]').length).toBe(1);

    deactivateWechatTheme();
    expect(document.querySelector('link[data-wx-stylesheet]'), '停用后应移除').toBeNull();

    await activateWechatTheme();
    expect(document.querySelectorAll('link[data-wx-stylesheet]').length).toBe(1);

    setTheme('light');
    await syncWechatTheme();
    document.querySelector('link[href$="css/titlebar.css"]')?.remove();
  });
});
