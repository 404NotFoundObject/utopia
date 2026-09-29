// js/ui/layout/wechatTheme.js - 微信主题的移动端视图协调
//
// 职责：微信主题（wechat / wechat-dark）在小屏（≤768px）下把界面分为
// 「会话列表层」（#sidebar 全屏）与「对话页」（#main），两层互斥显示，
// 由 <body data-wx-mobile-view="list|chat"> 驱动，样式见 css/wechat.css。
// 桌面端列表常驻，不涉及此状态机。
//
// 边界：
// - 不改动 sidebar.js 的抽屉逻辑：非微信主题下一切照旧；
//   微信主题下抽屉按钮由 CSS 隐藏，抽屉样式被列表层覆盖。
// - 朋友圈 / 世界书 / 设置等仍走模态框，不属于两层视图。

import { getAppState } from '../../core/state.js';

const state = getAppState();

export function isWechatTheme() {
  const theme = document.documentElement.getAttribute('data-theme');
  return theme === 'wechat' || theme === 'wechat-dark';
}

function isMobileViewport() {
  return window.innerWidth <= 768;
}

export function currentMobileView() {
  return document.body.dataset.wxMobileView || 'list';
}

/**
 * 切换移动端视图层
 * @param {'list'|'chat'} view
 */
export function setMobileView(view) {
  if (view !== 'list' && view !== 'chat') return;
  document.body.dataset.wxMobileView = view;
}

function clearMobileView() {
  delete document.body.dataset.wxMobileView;
}

/** 根据主题与视口决定是否启用两层视图；切回桌面/其他主题时清理状态 */
function refreshMode() {
  if (isWechatTheme() && isMobileViewport()) {
    if (!document.body.dataset.wxMobileView) {
      setMobileView('list');
    }
  } else {
    clearMobileView();
  }
}

/** 对话页头部注入返回按钮（幂等；仅微信主题移动端由 CSS 显示） */
function ensureBackButton() {
  if (document.getElementById('wxBackBtn')) return;
  const header = document.getElementById('chatHeader');
  if (!header) return;
  const btn = document.createElement('button');
  btn.id = 'wxBackBtn';
  btn.className = 'icon-btn';
  btn.type = 'button';
  btn.setAttribute('aria-label', '返回会话列表');
  btn.title = '返回会话列表';
  btn.innerHTML = '<i class="fas fa-chevron-left"></i>';
  btn.addEventListener('click', () => setMobileView('list'));
  header.insertBefore(btn, header.firstChild);
}

let initialized = false;

export function initWechatTheme() {
  if (initialized) return;
  initialized = true;

  ensureBackButton();
  refreshMode();

  // 启动时已恢复上次会话（订阅注册晚于恢复逻辑），补一次视图对齐
  if (state.get('currentCharacterId') !== null || state.get('currentGroupId') !== null) {
    if (isWechatTheme() && isMobileViewport()) {
      setMobileView('chat');
    }
  }

  window.addEventListener('resize', refreshMode);

  if (window.__eventBus && typeof window.__eventBus.on === 'function') {
    window.__eventBus.on('theme:changed', refreshMode);
  }

  // 选中角色 / 群组后进入对话页（仅微信主题 + 移动端）
  const enterChat = (id) => {
    if (id !== null && id !== undefined && isWechatTheme() && isMobileViewport()) {
      setMobileView('chat');
    }
  };
  state.subscribe('currentCharacterId', enterChat);
  state.subscribe('currentGroupId', enterChat);
}
