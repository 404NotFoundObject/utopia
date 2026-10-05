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
// - .wx-cover-topbar  朋友圈固定顶栏（sticky 贴顶：返回 / 标题 / 相机，
//                     封面滚出后进入磨砂 solid 态）
// - .wx-social-cover  朋友圈封面（仅微信主题注入；移动端全屏页面 /
//                     PC 悬浮窗共用）：背景图（可上传，localStorage
//                     持久化）、右下角用户头像与昵称；
//                     动态列表 / 发布 / 评论逻辑复用 socialUI.js 原实现。
//
// 边界：
// - 不改动 sidebar.js 的抽屉与按钮重建逻辑：非微信主题下一切照旧；
//   sidebar.js 在跨端 resize 时会整体重建 footer 按钮，这里用
//   MutationObserver 兜底补注入（注入幂等，不会形成循环）。
// - 朋友圈 / 世界书 / 设置等仍走模态框，不属于两层视图。

import { getAppState } from '../../core/state.js';
import { closeModal } from '../components/modal.js';
import { showToast } from '../components/toast.js';
import { pushView, releaseView, discardView } from './backNavigation.js';

const state = getAppState();

const USER_AVATAR_PLACEHOLDER =
  'data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' width=\'64\' height=\'64\' viewBox=\'0 0 64 64\'%3E%3Ccircle cx=\'32\' cy=\'32\' r=\'32\' fill=\'%23e0e0e6\'/%3E%3Ctext x=\'32\' y=\'41\' text-anchor=\'middle\' fill=\'%238a8aaa\' font-size=\'20\' font-family=\'sans-serif\'%3E?%3C/text%3E%3C/svg%3E';

/** 朋友圈背景图（移动端页面模式）的本地存储键 */
const SOCIAL_COVER_KEY = 'utopia:wx-social-cover';

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

/** 对话页在历史栈中的占位（Android 返回手势 = 回列表层） */
let wxChatViewId = null;

/**
 * 切换移动端视图层
 * @param {'list'|'chat'} view
 */
export function setMobileView(view) {
  if (view !== 'list' && view !== 'chat') return;
  const prev = currentMobileView();
  document.body.dataset.wxMobileView = view;

  if (view === 'chat' && prev !== 'chat' && wxChatViewId === null) {
    // 进入对话页：占一条历史记录。rawClose 不走 setMobileView，
    // 避免硬件返回路径里再次操作历史形成递归。
    wxChatViewId = pushView('wxchat', () => {
      wxChatViewId = null;
      document.body.dataset.wxMobileView = 'list';
    });
  } else if (view === 'list' && prev === 'chat' && wxChatViewId !== null) {
    // UI 主动返回（返回按钮 / dock 聊天 tab）：同步切层已完成，回收历史条目
    const id = wxChatViewId;
    wxChatViewId = null;
    releaseView(id);
  }
}

function clearMobileView() {
  if (wxChatViewId !== null) {
    // 视图状态被外部清除（切主题 / 回桌面端）：静默丢弃历史占位。
    // 残留的历史条目由 backNavigation 的 id 校验兜底（回退到它时空操作）。
    discardView(wxChatViewId);
    wxChatViewId = null;
  }
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

/** 图片读入并压缩为 JPEG dataURL（控制 localStorage 占用） */
function compressImage(file, maxSize = 1280, quality = 0.85) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const scale = Math.min(1, maxSize / Math.max(img.width, img.height));
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL('image/jpeg', quality));
      };
      img.onerror = reject;
      img.src = reader.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

/**
 * 朋友圈封面与固定顶栏（幂等）：openSocialFeed 渲染模态后由 observer 触发，
 * 仅在微信主题下于 .social-feed 顶部注入微信式结构——
 * - .wx-cover-topbar：sticky 固定顶栏（返回按钮 / 居中标题 / 相机上传入口），
 *   始终贴滚动容器顶部，长列表滚动时返回按钮不会随之滚出屏幕；封面滚出
 *   视口后进入 .solid 态（磨砂背景 + 标题浮现，见 css/wechat.css）。
 * - .wx-social-cover：封面区——背景图（可上传，localStorage 持久化）、
 *   右下角用户头像与昵称。
 * 非微信主题不注入，并清除主题切换后可能残留的注入节点，使朋友圈恢复
 * social.css 原生模态布局。动态列表 / 发布 / 评论等逻辑全部复用
 * socialUI.js 原有实现。
 */
export function ensureSocialCover() {
  const feed = document.querySelector('#modalContent .social-feed');
  if (!isWechatTheme()) {
    unbindCoverScroll();
    feed?.querySelector('.wx-cover-topbar')?.remove();
    feed?.querySelector('.wx-social-cover')?.remove();
    return;
  }
  if (!feed) return;
  let topbar = feed.querySelector('.wx-cover-topbar');
  const isNewTopbar = !topbar;
  if (isNewTopbar) {
    topbar = document.createElement('div');
    topbar.className = 'wx-cover-topbar';
    topbar.innerHTML = `
      <button class="wx-cover-back" type="button" aria-label="返回"><i class="fas fa-chevron-left"></i></button>
      <span class="wx-cover-title">朋友圈</span>
      <button class="wx-cover-camera" type="button" aria-label="发表动态" title="发表动态"><i class="fas fa-camera"></i></button>
      <input type="file" class="wx-cover-upload-input" accept="image/*">
    `;
    feed.insertBefore(topbar, feed.firstChild);
  }

  let cover = feed.querySelector('.wx-social-cover');
  const isNewCover = !cover;
  if (isNewCover) {
    const saved = (() => {
      try { return localStorage.getItem(SOCIAL_COVER_KEY); } catch (_) { return null; }
    })();
    cover = document.createElement('div');
    cover.className = 'wx-social-cover';
    cover.innerHTML = `
      <div class="wx-social-me">
        <span class="wx-me-name"></span>
        <img alt="我的头像">
      </div>
    `;
    feed.insertBefore(cover, topbar.nextSibling);

    if (saved) {
      const bg = document.createElement('img');
      bg.className = 'wx-cover-img';
      bg.alt = '';
      bg.src = saved;
      cover.insertBefore(bg, cover.firstChild);
    }
  }

  const settings = state.get('settings');
  cover.querySelector('.wx-me-name').textContent = settings?.user?.name || '我';
  cover.querySelector('.wx-social-me img').src = settings?.user?.avatar || USER_AVATAR_PLACEHOLDER;

  if (isNewTopbar) {
    topbar.querySelector('.wx-cover-back').addEventListener('click', () => closeModal());

    const uploadInput = topbar.querySelector('.wx-cover-upload-input');
    // 与微信一致：相机按钮 = 发表动态。转发给发布按钮（微信主题下该按钮
    // 隐藏但监听仍在），发布框开合逻辑完全复用 socialUI.js 原实现。
    topbar.querySelector('.wx-cover-camera').addEventListener('click', () => {
      document.getElementById('socialTogglePublishBtn')?.click();
    });
    uploadInput.addEventListener('change', async () => {
      const file = uploadInput.files?.[0];
      if (!file) return;
      try {
        const dataUrl = await compressImage(file);
        try { localStorage.setItem(SOCIAL_COVER_KEY, dataUrl); } catch (_) { /* 超限时仅本次生效 */ }
        let bg = cover.querySelector('.wx-cover-img');
        if (!bg) {
          bg = document.createElement('img');
          bg.className = 'wx-cover-img';
          bg.alt = '';
          cover.insertBefore(bg, cover.firstChild);
        }
        bg.src = dataUrl;
        showToast('背景已更新', 'success');
      } catch (_) {
        showToast('背景更新失败', 'error');
      } finally {
        uploadInput.value = '';
      }
    });
  }

  if (isNewCover) {
    // 与微信一致：点封面区域更换背景图（头像/昵称区除外，避免误触）。
    // 上传入口从相机按钮移到这里。
    const uploadInput = topbar.querySelector('.wx-cover-upload-input');
    cover.addEventListener('click', (e) => {
      if (e.target.closest('.wx-social-me')) return;
      uploadInput?.click();
    });
  }

  bindCoverScroll();
  syncSocialTopbarSolid();
}

/**
 * 顶栏 solid 态同步：封面（含头像区）完全滚出视口顶部后，固定顶栏从
 * 「封面上的悬浮按钮」切换为「磨砂标题栏」。由模块级滚动监听驱动；
 * #modalContent 为复用元素，监听器只注册一次，避免随模态重开而累积。
 */
function syncSocialTopbarSolid() {
  const feed = document.querySelector('#modalContent .social-feed');
  const topbar = feed?.querySelector('.wx-cover-topbar');
  if (!topbar) return;
  const cover = feed.querySelector('.wx-social-cover');
  const bottom = cover ? cover.getBoundingClientRect().bottom : 0;
  topbar.classList.toggle('solid', bottom <= 0);
}

/**
 * 顶栏 solid 态的滚动驱动：监听滚动容器 #modalContent 本身，而不是在
 * document 上常驻 capture 监听。挂在容器上是为了让监听器生命周期跟着
 * 封面走——封面随主题切出被移除时这里同步解绑，不留常驻副作用。
 */
function bindCoverScroll() {
  const scroller = document.getElementById('modalContent');
  if (!scroller || scroller.__wxCoverScrollBound) return;
  scroller.__wxCoverScrollBound = true;
  scroller.addEventListener('scroll', syncSocialTopbarSolid, { passive: true });
}

function unbindCoverScroll() {
  const scroller = document.getElementById('modalContent');
  if (!scroller || !scroller.__wxCoverScrollBound) return;
  delete scroller.__wxCoverScrollBound;
  scroller.removeEventListener('scroll', syncSocialTopbarSolid);
}

/** 点击菜单与「+」以外区域时收起菜单；返回解绑函数供皮肤停用调用 */
function bindPlusMenuDismiss() {
  const onDocumentClick = (e) => {
    const menu = document.getElementById('wxPlusMenu');
    if (!menu || !menu.classList.contains('open')) return;
    const plus = document.getElementById('wxPlusBtn');
    if (menu.contains(e.target) || plus?.contains(e.target)) return;
    closePlusMenu();
  };
  document.addEventListener('click', onDocumentClick);
  return () => document.removeEventListener('click', onDocumentClick);
}

/** 幂等补齐全部注入节点 */
export function ensureInjectedNodes() {
  ensureBackButton();
  ensureDockChatButton();
  ensureUserAvatar();
  ensurePlusMenu();
}

// ============================================================
// 皮肤生命周期
//
// 注入节点、MutationObserver、state 订阅与 DOM 监听器都是「只在微信主题下
// 才需要」的副作用。此前用一次性布尔守卫装配，装配后永不卸载：切到别的
// 主题时这些节点（被 css/wechat.css 全局 display:none 兜住，看不见）连同
// 监听器与 observer 一起滞留到会话结束。
//
// 现在拆成 activate / deactivate 一对：
// - activate 期间产生的每个副作用都登记进 disposers，deactivate 统一回收
// - theme:changed 的调度器不属于皮肤自身（切走后还要能切回来），保持常驻
// ============================================================

/** 皮肤当前是否激活（供 observer 在延迟调度窗口内二次确认） */
let active = false;

/** 当前激活流程的就绪 Promise（样式表加载 + 副作用装配完成） */
let activatePromise = null;

/** activate 登记的回收函数 */
const disposers = [];

/** 登记一个随皮肤停用而执行的回收动作 */
function track(dispose) {
  if (typeof dispose === 'function') disposers.push(dispose);
}

function runDisposers() {
  const pending = disposers.splice(0, disposers.length);
  for (const dispose of pending) {
    try {
      dispose();
    } catch (err) {
      console.error('[wechatTheme] 回收皮肤副作用失败:', err);
    }
  }
}

/** 移除全部注入节点（与 ensureInjectedNodes 一一对应） */
function removeInjectedNodes() {
  for (const id of ['wxBackBtn', 'wxDockChatBtn', 'wxUserAvatar', 'wxPlusBtn', 'wxPlusMenu']) {
    document.getElementById(id)?.remove();
  }
}

/**
 * 按需加载皮肤样式表：wechat.css 不在 index.html 常驻（非微信主题下
 * 几十 KB 规则全程参与 CSSOM 匹配），激活时注入、停用时移除。
 * 插入点必须在 titlebar.css 之前——窗口装饰器样式表依赖加载顺序
 * 覆盖 wechat 的变量（原先由 index.html 的静态顺序保证）。
 *
 * @returns {Promise<void>} 样式表加载完成（或失败，失败不阻塞装配）
 */
function ensureStylesheet() {
  const existing = document.querySelector('link[data-wx-stylesheet]');
  if (existing) {
    // 已存在但可能尚未加载完成：sheet 就绪即完成
    return existing.sheet ? Promise.resolve() : waitForSheet(existing);
  }
  // 首次注入：首次样式计算不含 wechat.css，link 应用瞬间会触发全站
  // `*` 通用 transition（背景色 250ms 动画）。先禁掉过渡让首帧直接到位，
  // 加载完成后双 rAF 恢复（见 main.css 的 html[data-wx-loading] 规则）。
  document.documentElement.setAttribute('data-wx-loading', '');
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = 'css/wechat.css';
  link.dataset.wxStylesheet = '';
  const titlebar = document.querySelector('link[href$="css/titlebar.css"]');
  const parent = titlebar?.parentNode ?? document.head;
  if (!parent) {
    document.documentElement.removeAttribute('data-wx-loading');
    return Promise.resolve();
  }
  parent.insertBefore(link, titlebar ?? null);
  return waitForSheet(link).then(() => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        document.documentElement.removeAttribute('data-wx-loading');
      });
    });
  });
}

/** 等待 link 的 CSSOM 就绪（load/error 任一即返回，不阻塞在失败上） */
function waitForSheet(link) {
  return new Promise((resolve) => {
    if (link.sheet) {
      resolve();
      return;
    }
    // jsdom 等单测环境不加载资源、不派发 load 事件：直接视为就绪，
    // 否则 activate 的装配永远挂在微任务之后，同步断言全部竞争失败
    if (typeof navigator !== 'undefined' && /jsdom/i.test(navigator.userAgent)) {
      resolve();
      return;
    }
    link.addEventListener('load', () => resolve(), { once: true });
    link.addEventListener('error', () => resolve(), { once: true });
  });
}

function removeStylesheet() {
  document.querySelector('link[data-wx-stylesheet]')?.remove();
}

/** 激活微信皮肤：装配注入节点与全部监听；重复调用返回同一就绪 Promise */
export function activateWechatTheme() {
  if (active) return activatePromise ?? Promise.resolve();
  active = true;

  // 样式表先注入并等就绪：注入节点的量宽/视图计算不能跑在裸样式上
  const stylesheetReady = ensureStylesheet();
  track(removeStylesheet);
  // 加载中途被停用时清掉禁用过渡标记，避免过渡被永久禁用
  track(() => document.documentElement.removeAttribute('data-wx-loading'));

  activatePromise = stylesheetReady.then(() => {
    // 等待期间可能已被停用（快速来回切换）
    if (!active) return;

    ensureInjectedNodes();
    refreshMode();

    track(bindPlusMenuDismiss());
    track(bindRebuildObserver());

    // 用户在设置里更换头像 / 用户名时同步左上角头像
    track(state.subscribe('settings', () => updateUserAvatar()));

    window.addEventListener('resize', refreshMode);
    track(() => window.removeEventListener('resize', refreshMode));

    // 启动时已恢复上次会话（订阅注册晚于恢复逻辑），补一次视图对齐
    if (state.get('currentCharacterId') !== null || state.get('currentGroupId') !== null) {
      if (isWechatTheme() && isMobileViewport()) {
        setMobileView('chat');
      }
    }

    // 选中角色 / 群组后进入对话页（仅微信主题 + 移动端）
    const enterChat = (id) => {
      if (id !== null && id !== undefined && isWechatTheme() && isMobileViewport()) {
        setMobileView('chat');
      }
    };
    track(state.subscribe('currentCharacterId', enterChat));
    track(state.subscribe('currentGroupId', enterChat));
  });
  return activatePromise;
}

/** 停用微信皮肤：回收所有副作用并清除注入 DOM；重复调用无副作用 */
export function deactivateWechatTheme() {
  if (!active) return;
  active = false;
  activatePromise = null;

  runDisposers();
  removeInjectedNodes();
  clearMobileView();
  // 朋友圈封面与顶栏随主题走：非微信主题下这里会一并清除
  ensureSocialCover();
}

/** 按当前主题把皮肤拉到应有状态（幂等）；activate 返回就绪 Promise */
export function syncWechatTheme() {
  if (isWechatTheme()) {
    return activateWechatTheme();
  }
  deactivateWechatTheme();
  return Promise.resolve();
}

/**
 * sidebar.js 跨端 resize 时会整体重建 footer 按钮，注入节点可能被清掉；
 * 朋友圈模态渲染 / 重渲染时需要补封面。观察 #sidebar 与 #modalOverlay
 * 两个子树，变动后统一补齐。所有注入均幂等：补齐后不再产生 DOM 变更，
 * observer 不会形成循环。
 */
function bindRebuildObserver() {
  const sidebar = document.getElementById('sidebar');
  if (!sidebar || typeof MutationObserver !== 'function') return () => {};
  let scheduled = false;
  let timer = null;
  const observer = new MutationObserver(() => {
    if (scheduled) return;
    scheduled = true;
    timer = setTimeout(() => {
      scheduled = false;
      timer = null;
      // 皮肤可能已在调度窗口内被停用，停下来避免重新注入
      if (!active) return;
      ensureInjectedNodes();
      ensureSocialCover();
    }, 100);
  });
  observer.observe(sidebar, { childList: true, subtree: true });
  const overlay = document.getElementById('modalOverlay');
  if (overlay) observer.observe(overlay, { childList: true, subtree: true });

  return () => {
    observer.disconnect();
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  };
}

let initialized = false;

/**
 * 装配入口：把皮肤拉到与当前主题一致的状态，并订阅后续主题切换。
 *
 * 这里注册的是「皮肤管理器」级别的调度器，切出微信主题后也必须继续存活，
 * 否则再也收不到切回来的事件；皮肤自身的副作用全部在
 * activateWechatTheme / deactivateWechatTheme 内部成对装配与回收。
 */
/**
 * 常驻调度器：主题切换事件 → 皮肤 activate / deactivate。
 * 刻意不随皮肤回收（切走后还要能切回来）。
 *
 * @returns {Promise<void>} 若启动时已处于微信主题，resolve 于皮肤完全
 *   就绪（样式表加载完成、注入节点装配完毕）；否则立即 resolve。
 *   启动序列应在置位 __utopiaReady 之前 await 它，保证恢复微信主题
 *   时首帧就带完整样式（否则既有 E2E 与真实用户都会看到裸样式一帧）。
 */
export function initWechatTheme() {
  if (initialized) return Promise.resolve();
  initialized = true;

  const startupReady = syncWechatTheme();

  if (window.__eventBus && typeof window.__eventBus.on === 'function') {
    window.__eventBus.on('theme:changed', syncWechatTheme);
  }
  return startupReady ?? Promise.resolve();
}
