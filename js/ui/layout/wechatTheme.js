// js/ui/layout/wechatTheme.js - 微信主题的移动端视图协调
//
// 职责：微信主题（wechat / wechat-dark）在小屏（≤768px）下把界面分为
// 「会话列表层」（#sidebar 全屏）与「对话页」（#main），两层互斥显示，
// 由 <body data-wx-mobile-view="list|chat"> 驱动，样式见 css/wechat.css。
// 桌面端列表常驻，不涉及此状态机。
//
// 注入节点（全部默认 display:none，微信主题对应断点内放开，见 css）：
// - #wxBackBtn        对话页头部返回按钮（移动端）
// - #wxDockChatBtn    底部 dock 的「聊天」tab：点击回到会话列表层
// - #wxUserAvatar     桌面图标栏左上角的用户头像（头像源 settings.user.avatar）
// - #wxPlusBtn/#wxPlusMenu
//                     移动端列表层右上角「+」与折叠菜单；菜单项点击
//                     转发给 footer 内被隐藏的原按钮（事件绑定仍在
//                     sidebar.js 侧，转发 click 即可复用）。
//
// 边界：
// - 不改动 sidebar.js 的抽屉与按钮重建逻辑：非微信主题下一切照旧；
//   sidebar.js 在跨端 resize 时会整体重建 footer 按钮，这里用
//   MutationObserver 兜底补注入（注入幂等，不会形成循环）。
// - 朋友圈 / 世界书 / 设置等仍走模态框，不属于两层视图。

import { getAppState } from '../../core/state.js';

const state = getAppState();

const USER_AVATAR_PLACEHOLDER =
  'data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' width=\'64\' height=\'64\' viewBox=\'0 0 64 64\'%3E%3Ccircle cx=\'32\' cy=\'32\' r=\'32\' fill=\'%23e0e0e6\'/%3E%3Ctext x=\'32\' y=\'41\' text-anchor=\'middle\' fill=\'%238a8aaa\' font-size=\'20\' font-family=\'sans-serif\'%3E?%3C/text%3E%3C/svg%3E';

/** 「+」折叠菜单项：target 为 footer 内对应按钮 id，点击时转发 click */
const PLUS_MENU_ITEMS = [
  { target: 'createGroupBtn', icon: 'fa-comments', label: '发起群聊' },
  { target: 'createBtn', icon: 'fa-user-plus', label: '添加角色' },
  { target: 'importBtn', icon: 'fa-file-import', label: '导入角色' },
  { target: 'worldbookBtn', icon: 'fa-book-open', label: '世界书' },
  { target: 'themeToggleBtn', icon: 'fa-moon', label: '切换主题' },
];

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

/** 底部 dock 注入「聊天」tab（幂等）：点击回到会话列表层 */
function ensureDockChatButton() {
  if (document.getElementById('wxDockChatBtn')) return;
  const footer = document.querySelector('#sidebar .sidebar-footer');
  if (!footer) return;
  const btn = document.createElement('button');
  btn.id = 'wxDockChatBtn';
  btn.className = 'sidebar-btn';
  btn.type = 'button';
  btn.setAttribute('aria-label', '聊天');
  btn.title = '聊天';
  btn.innerHTML = '<i class="fas fa-comment"></i><span>聊天</span>';
  btn.addEventListener('click', () => {
    if (isWechatTheme() && isMobileViewport()) setMobileView('list');
  });
  footer.insertBefore(btn, footer.firstChild);
}

/** 桌面图标栏顶部注入用户头像（幂等）：点击打开设置 */
function ensureUserAvatar() {
  if (document.getElementById('wxUserAvatar')) return;
  const footer = document.querySelector('#sidebar .sidebar-footer');
  if (!footer) return;
  const img = document.createElement('img');
  img.id = 'wxUserAvatar';
  img.alt = '用户头像';
  img.title = '个人设置';
  updateUserAvatar(img);
  img.addEventListener('click', () => {
    document.getElementById('settingsBtn')?.click();
  });
  footer.insertBefore(img, footer.firstChild);
}

/** 从 settings 读取当前用户头像与刷新预览 */
function updateUserAvatar(img) {
  const el = img || document.getElementById('wxUserAvatar');
  if (!el) return;
  const avatar = state.get('settings')?.user?.avatar;
  el.src = avatar || USER_AVATAR_PLACEHOLDER;
}

/** 列表层右上角注入「+」按钮与折叠菜单（幂等） */
function ensurePlusMenu() {
  const header = document.querySelector('#sidebar .sidebar-header');
  if (!header) return;

  if (!document.getElementById('wxPlusBtn')) {
    const plus = document.createElement('button');
    plus.id = 'wxPlusBtn';
    plus.type = 'button';
    plus.setAttribute('aria-label', '更多功能');
    plus.title = '更多功能';
    plus.innerHTML = '<i class="fas fa-plus"></i>';
    plus.addEventListener('click', (e) => {
      e.stopPropagation();
      const menu = document.getElementById('wxPlusMenu');
      if (menu) menu.classList.toggle('open');
    });
    header.appendChild(plus);
  }

  if (!document.getElementById('wxPlusMenu')) {
    const menu = document.createElement('div');
    menu.id = 'wxPlusMenu';
    for (const item of PLUS_MENU_ITEMS) {
      const entry = document.createElement('div');
      entry.className = 'wx-menu-item';
      entry.innerHTML = `<i class="fas ${item.icon}"></i><span>${item.label}</span>`;
      entry.addEventListener('click', (e) => {
        e.stopPropagation();
        closePlusMenu();
        document.getElementById(item.target)?.click();
      });
      menu.appendChild(entry);
    }
    header.appendChild(menu);
  }
}

function closePlusMenu() {
  document.getElementById('wxPlusMenu')?.classList.remove('open');
}

/** 点击菜单与「+」以外区域时收起菜单 */
function bindPlusMenuDismiss() {
  document.addEventListener('click', (e) => {
    const menu = document.getElementById('wxPlusMenu');
    if (!menu || !menu.classList.contains('open')) return;
    const plus = document.getElementById('wxPlusBtn');
    if (menu.contains(e.target) || plus?.contains(e.target)) return;
    closePlusMenu();
  });
}

/** 幂等补齐全部注入节点 */
export function ensureInjectedNodes() {
  ensureBackButton();
  ensureDockChatButton();
  ensureUserAvatar();
  ensurePlusMenu();
}

/**
 * sidebar.js 跨端 resize 时会整体重建 footer 按钮，注入节点可能被清掉。
 * 观察 #sidebar 子树，变动后补注入。注入是幂等的：补齐完成后不再有
 * DOM 变更，observer 不会形成循环。
 */
function bindRebuildObserver() {
  const sidebar = document.getElementById('sidebar');
  if (!sidebar || typeof MutationObserver !== 'function') return;
  let scheduled = false;
  const observer = new MutationObserver(() => {
    if (scheduled) return;
    scheduled = true;
    setTimeout(() => {
      scheduled = false;
      ensureInjectedNodes();
    }, 100);
  });
  observer.observe(sidebar, { childList: true, subtree: true });
}

let initialized = false;

export function initWechatTheme() {
  if (initialized) return;
  initialized = true;

  ensureInjectedNodes();
  refreshMode();
  bindPlusMenuDismiss();
  bindRebuildObserver();

  // 用户在设置里更换头像 / 用户名时同步左上角头像
  state.subscribe('settings', () => updateUserAvatar());

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
