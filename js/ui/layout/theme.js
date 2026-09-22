// js/ui/layout/theme.js - 主题管理（支持内置主题 + 自定义主题）
import { THEME_PRESETS } from '../themes/themePresets.js';
import {
  getCustomThemes,
  getCustomTheme,
  isCustomThemeId,
} from '../themes/themeStorage.js';

const STORAGE_KEY = 'utopia-theme';

let currentThemeId = null;

// ============================================================
// 圆角 / 阴影：抽象系数 → CSS 变量
// 供主题制作器实时预览 + applyTheme 共用，保证一致
// ============================================================

export function computeRadiusVars(scale) {
  const val = Math.max(0, Math.min(100, Number(scale) || 0));
  const base = 4 + (val / 100) * 20;
  return {
    '--radius-xs': `${(base * 0.5).toFixed(1)}px`,
    '--radius-sm': `${(base * 0.75).toFixed(1)}px`,
    '--radius-md': `${base.toFixed(1)}px`,
    '--radius-lg': `${(base * 1.5).toFixed(1)}px`,
    '--radius-xl': `${(base * 2).toFixed(1)}px`,
    '--radius-2xl': `${(base * 3).toFixed(1)}px`,
    '--radius-full': `${(base * 4).toFixed(1)}px`,
  };
}

export function computeShadowVars(scale) {
  const val = Math.max(0, Math.min(200, Number(scale) || 0)) / 100;
  const base = 1 + val * 4;
  return {
    '--shadow-xs': `0 ${(base * 0.5).toFixed(1)}px ${base.toFixed(1)}px rgba(0, 0, 0, ${(0.04 * val).toFixed(3)})`,
    '--shadow-sm': `0 ${base.toFixed(1)}px ${(base * 2).toFixed(1)}px rgba(0, 0, 0, ${(0.06 * val).toFixed(3)})`,
    '--shadow-md': `0 ${(base * 2).toFixed(1)}px ${(base * 4).toFixed(1)}px rgba(108, 92, 231, ${(0.12 * val).toFixed(3)})`,
    '--shadow-lg': `0 ${(base * 4).toFixed(1)}px ${(base * 8).toFixed(1)}px rgba(0, 0, 0, ${(0.12 * val).toFixed(3)})`,
    '--shadow-xl': `0 ${(base * 6).toFixed(1)}px ${(base * 12).toFixed(1)}px rgba(0, 0, 0, ${(0.18 * val).toFixed(3)})`,
  };
}

// ============================================================
// 主题查询
// ============================================================

/**
 * 获取所有可用主题（内置 + 自定义）
 * @returns {Array<{id, name, isCustom, baseTheme}>}
 */
export function getAvailableThemes() {
  const builtin = Object.values(THEME_PRESETS).map(t => ({
    id: t.id,
    name: t.name,
    isCustom: false,
    baseTheme: t.id,
  }));
  const custom = getCustomThemes().map(t => ({
    id: t.id,
    name: t.name,
    isCustom: true,
    baseTheme: t.baseTheme || 'light',
  }));
  return [...builtin, ...custom];
}

/**
 * 按 id 获取主题的完整 CSS 变量（已合并 baseTheme + 用户覆盖 + 圆角/阴影系数）
 * @param {string} themeId
 * @returns {Object|null} 变量字典，或 null 表示主题不存在
 */
export function getThemeVariablesById(themeId) {
  if (!themeId) return null;

  // 1. 内置主题：直接返回
  const builtinVars = THEME_PRESETS[themeId]?.variables;
  if (builtinVars) return { ...builtinVars };

  // 2. 自定义主题：baseTheme 变量 + 用户覆盖 + 圆角/阴影
  const custom = getCustomTheme(themeId);
  if (!custom) return null;

  const baseVars = THEME_PRESETS[custom.baseTheme]?.variables
    || THEME_PRESETS.light.variables;

  const merged = { ...baseVars };
  const vars = custom.variables || {};
  for (const [key, value] of Object.entries(vars)) {
    // 圆角/阴影由系数统一计算，忽略 variables 里的残留值
    if (key.startsWith('--radius-')) continue;
    if (key.startsWith('--shadow-')) continue;
    merged[key] = value;
  }

  Object.assign(merged, computeRadiusVars(custom.radiusScale ?? 50));
  Object.assign(merged, computeShadowVars(custom.shadowScale ?? 100));

  return merged;
}

// ============================================================
// 初始化
// ============================================================

export function initTheme() {
  const savedTheme = localStorage.getItem(STORAGE_KEY) || 'light';
  const exists = getThemeVariablesById(savedTheme);
  if (!exists) {
    // 保存的主题 id 已失效（例如自定义主题被删除）
    console.log(`[Theme] 保存的主题 "${savedTheme}" 不存在，回退到 light`);
    applyTheme('light');
    return;
  }
  applyTheme(savedTheme);
  currentThemeId = savedTheme;
}

// ============================================================
// 应用主题
// ============================================================

export function applyTheme(themeId) {
  const root = document.documentElement;

  let variables = getThemeVariablesById(themeId);
  let actualThemeId = themeId;

  if (!variables) {
    console.warn(`[Theme] 未知主题: ${themeId}，回退到 light`);
    actualThemeId = 'light';
    variables = getThemeVariablesById('light');
    if (!variables) return;
  }

  // 写入所有 CSS 变量
  for (const [key, value] of Object.entries(variables)) {
    root.style.setProperty(key, value);
  }

  // data-theme：内置主题用自身 id；自定义主题用 baseTheme（复用兜底 CSS 变量）
  let dataTheme = actualThemeId;
  if (isCustomThemeId(actualThemeId)) {
    const custom = getCustomTheme(actualThemeId);
    dataTheme = custom?.baseTheme || 'light';
    root.setAttribute('data-theme-custom', actualThemeId);
  } else {
    root.removeAttribute('data-theme-custom');
  }
  root.setAttribute('data-theme', dataTheme);

  localStorage.setItem(STORAGE_KEY, actualThemeId);
  currentThemeId = actualThemeId;

  updateThemeIcon(dataTheme, isCustomThemeId(actualThemeId));
  syncSelect(actualThemeId);

  if (window.__eventBus) {
    window.__eventBus.emit('theme:changed', { themeId: actualThemeId, variables });
  }
}

// ============================================================
// 切换主题（循环）
// ============================================================

export function toggleTheme() {
  const list = getAvailableThemes();
  if (list.length === 0) return;

  const current = getCurrentTheme();
  let idx = list.findIndex(t => t.id === current);
  if (idx === -1) idx = 0;

  const next = list[(idx + 1) % list.length];
  applyTheme(next.id);
}

// ============================================================
// 图标 / 下拉框同步
// ============================================================

function updateThemeIcon(theme, isCustom) {
  const btn = document.getElementById('themeToggleBtn');
  if (!btn) return;
  const icon = btn.querySelector('i');
  if (!icon) return;

  if (isCustom) {
    icon.className = 'fas fa-palette';
  } else if (theme === 'dark') {
    icon.className = 'fas fa-sun';
  } else if (theme === 'cyberpunk') {
    icon.className = 'fas fa-robot';
  } else {
    icon.className = 'fas fa-moon';
  }
}

function syncSelect(themeId) {
  const select = document.getElementById('settingsThemeSelect');
  if (select) select.value = themeId;
}

export function bindThemeToggle() {
  const btn = document.getElementById('themeToggleBtn');
  if (btn) btn.addEventListener('click', toggleTheme);
}

// ============================================================
// 获取当前主题 id
// ============================================================

export function getCurrentTheme() {
  if (currentThemeId) return currentThemeId;

  const domCustom = document.documentElement.getAttribute('data-theme-custom');
  if (domCustom) return domCustom;

  const domTheme = document.documentElement.getAttribute('data-theme');
  if (domTheme) return domTheme;

  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored) return stored;

  return 'light';
}