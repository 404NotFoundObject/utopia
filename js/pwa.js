// js/pwa.js - PWA：Service Worker 注册、版本更新提示、窗口装饰器
//
// 纯增量接入：注册失败（非安全上下文 / 浏览器不支持）时静默降级，
// 不影响应用其余功能；发现新版本时用 toast 提示用户手动刷新，
// 不自动重载，避免打断进行中的对话输入。

import { showToast } from './ui/components/toast.js';

// ============================================================
// 窗口装饰器色（PWA 标题栏 / 浏览器地址栏）
// ============================================================

// 主题变量由 theme.js 注入，取其底色；取不到时逐级回退
function readThemeColor() {
  const style = getComputedStyle(document.documentElement);
  const candidates = ['--color-bg-secondary', '--color-bg-primary'];
  for (const name of candidates) {
    const value = style.getPropertyValue(name).trim();
    if (value) return value;
  }
  return null;
}

// 窗口装饰器 / 浏览器 UI 色（PWA 标题栏、地址栏）跟随当前主题底色
function syncThemeColor() {
  const meta = document.querySelector('meta[name="theme-color"]');
  if (!meta) return;
  const color = readThemeColor();
  if (color && meta.getAttribute('content') !== color) {
    meta.setAttribute('content', color);
  }
}

// __eventBus 由 app.js 在异步初始化（数据库校验）之后才挂载，
// 本模块作为独立 module script 会先执行，因此这里轮询等待其就绪，
// 否则主题切换后窗口装饰器色不会更新。
function onThemeChanged(cb) {
  if (window.__eventBus && typeof window.__eventBus.on === 'function') {
    window.__eventBus.on('theme:changed', cb);
    return;
  }
  let tries = 0;
  const timer = setInterval(() => {
    if (window.__eventBus && typeof window.__eventBus.on === 'function') {
      window.__eventBus.on('theme:changed', cb);
      clearInterval(timer);
    } else if (++tries > 100) {
      clearInterval(timer);
    }
  }, 100);
}

// ============================================================
// 窗口控件叠加（Window Controls Overlay）
// ============================================================

const TITLEBAR_STORE_KEY = 'utopia_wco_titlebar';

// 取色来源：决定装饰条用主题的哪一支底色
const TITLEBAR_COLOR_VARS = {
  secondary: '--color-bg-secondary',
  primary: '--color-bg-primary',
  sidebar: '--color-bg-sidebar',
  input: '--color-bg-input',
};

// 默认取「面板底色」：装饰条下方是聊天页底色，两者有细微色差，
// 半透明玻璃层才能读出层次；取「聊天页底色」会与页面浑然一体（微信式无缝）。
const TITLEBAR_DEFAULTS = { glass: true, alpha: 0.72, blur: 18, color: 'input' };

function clampNum(value, min, max, fallback) {
  const n = typeof value === 'number' ? value : parseFloat(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

/**
 * 读取窗口装饰器偏好（磨砂玻璃开关 / 不透明度 / 模糊半径 / 取色来源）
 * @returns {{glass: boolean, alpha: number, blur: number, color: string}}
 */
export function getTitlebarPrefs() {
  let raw = {};
  try {
    raw = JSON.parse(localStorage.getItem(TITLEBAR_STORE_KEY) || '{}') || {};
  } catch (_) {
    raw = {};
  }
  return {
    glass: raw.glass !== false,
    alpha: clampNum(raw.alpha, 0.2, 1, TITLEBAR_DEFAULTS.alpha),
    blur: clampNum(raw.blur, 0, 48, TITLEBAR_DEFAULTS.blur),
    color: TITLEBAR_COLOR_VARS[raw.color] ? raw.color : TITLEBAR_DEFAULTS.color,
  };
}

/**
 * 写入并立即应用窗口装饰器偏好（不经过「保存设置」，改动即时可见）
 * @param {Partial<{glass: boolean, alpha: number, blur: number, color: string}>} patch
 * @returns {{glass: boolean, alpha: number, blur: number, color: string}} 合并后的偏好
 */
export function setTitlebarPrefs(patch = {}) {
  const next = { ...getTitlebarPrefs(), ...patch };
  try {
    localStorage.setItem(TITLEBAR_STORE_KEY, JSON.stringify(next));
  } catch (_) { /* 隐私模式下写入失败：仅本次会话生效 */ }
  applyTitlebarPrefs();
  return next;
}

// 当前是否处于窗口控件叠加模式（仅安装后的桌面 PWA 窗口）
export function isWcoActive() {
  if (typeof window.matchMedia !== 'function') return false;
  return window.matchMedia('(display-mode: window-controls-overlay)').matches;
}

// 把偏好写成 CSS 变量 / data 属性；CSS 变量用 var() 间接引用主题色，
// 因此切换主题时装饰条自动换色，无需额外同步。
export function applyTitlebarPrefs() {
  const root = document.documentElement;
  const prefs = getTitlebarPrefs();

  root.dataset.wco = isWcoActive() ? 'on' : 'off';
  root.dataset.wcoGlass = prefs.glass ? 'on' : 'off';

  const colorVar = TITLEBAR_COLOR_VARS[prefs.color] || TITLEBAR_COLOR_VARS.secondary;
  root.style.setProperty('--pwa-titlebar-bg', `var(${colorVar})`);
  root.style.setProperty('--pwa-glass-alpha', String(prefs.alpha));
  root.style.setProperty('--pwa-glass-blur', `${prefs.blur}px`);
  syncThemeColor();
}

// 装饰条本体：始终插入 DOM，由 CSS 决定是否显示（便于自检脚本验证接线）
function ensureTitleBar() {
  if (document.getElementById('pwaTitleBar')) return;
  const bar = document.createElement('div');
  bar.id = 'pwaTitleBar';
  bar.setAttribute('aria-hidden', 'true');
  document.body.prepend(bar);
}

function initWindowControls() {
  ensureTitleBar();
  applyTitlebarPrefs();

  // 用户在窗口里手动切换叠加层 / 最大化时同步状态
  if (typeof window.matchMedia === 'function') {
    const mq = window.matchMedia('(display-mode: window-controls-overlay)');
    const onChange = () => applyTitlebarPrefs();
    if (typeof mq.addEventListener === 'function') mq.addEventListener('change', onChange);
    else if (typeof mq.addListener === 'function') mq.addListener(onChange);
  }

  // 窗口缩放时标题栏几何变化，env() 会自动跟随，这里只刷新一次状态位
  const wco = navigator.windowControlsOverlay;
  if (wco && typeof wco.addEventListener === 'function') {
    wco.addEventListener('geometrychange', () => applyTitlebarPrefs());
  }

  onThemeChanged(() => applyTitlebarPrefs());
}

// ============================================================
// 入口
// ============================================================

export // 全量预缓存由 SW 在收到消息后执行；自动化环境（Playwright/headless）
// 跳过——安装期抓取全部代码会拖慢测试冷启动，真实用户则必须预缓存。
function schedulePrecache(reg) {
  if (navigator.webdriver) return;
  navigator.serviceWorker.ready
    .then((ready) => {
      if (ready.active) ready.active.postMessage({ type: 'precache' });
    })
    .catch(() => { /* SW 未就绪：运行期 SWR 兜底 */ });
}

function initPWA() {
  initWindowControls();
  onThemeChanged(syncThemeColor);

  if (!('serviceWorker' in navigator)) return;
  // file:// 或非安全上下文（除 localhost 外的 http）无法注册 SW
  if (location.protocol !== 'http:' && location.protocol !== 'https:') return;

  window.addEventListener('load', () => {
    // 主题变量由 theme.js 在启动流程中注入，须等其就绪后再取色
    syncThemeColor();
    setTimeout(syncThemeColor, 300);

    navigator.serviceWorker
      .register('./sw.js')
      .then((reg) => {
        reg.addEventListener('updatefound', () => {
          const next = reg.installing;
          if (!next) return;
          next.addEventListener('statechange', () => {
            // 首次安装（页面尚未被 SW 控制）不打扰；仅升级场景提示
            if (next.state === 'installed' && navigator.serviceWorker.controller) {
              showToast('新版本已就绪，刷新页面后生效', 'info');
            }
          });
        });
        schedulePrecache(reg);
      })
      .catch(() => { /* SW 不可用：静默降级 */ });
  });
}

initPWA();
