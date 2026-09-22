/**
 * @module ui/themes/themeStorage
 * @description 自定义主题的 localStorage 持久化
 *
 * 存储格式：
 *   localStorage['utopia:custom-themes'] = JSON.stringify(ThemeRecord[])
 *
 * ThemeRecord:
 *   {
 *     id: string,               // 'custom-<timestamp>-<rand>' 前缀标记为自定义
 *     name: string,
 *     baseTheme: string,        // 'light' | 'dark' | 'cyberpunk'
 *     variables: object,        // 颜色变量覆盖（不含 --radius-* / --shadow-*）
 *     radiusScale: number,      // 0~100，抽象系数
 *     shadowScale: number,      // 0~200，抽象系数
 *     createdAt: number,
 *     updatedAt: number,
 *   }
 */

const STORAGE_KEY = 'utopia:custom-themes';
const CUSTOM_ID_PREFIX = 'custom-';

function readAll() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const list = JSON.parse(raw);
    return Array.isArray(list) ? list : [];
  } catch (e) {
    console.warn('[ThemeStorage] 读取失败:', e);
    return [];
  }
}

function writeAll(list) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
  } catch (e) {
    console.warn('[ThemeStorage] 写入失败:', e);
  }
}

export function getCustomThemes() {
  return readAll();
}

export function getCustomTheme(id) {
  if (!id) return null;
  return readAll().find(t => t.id === id) || null;
}

export function saveCustomTheme(theme) {
  if (!theme || !theme.id) {
    throw new Error('[ThemeStorage] 主题 id 必须存在');
  }
  const list = readAll();
  const now = Date.now();
  const idx = list.findIndex(t => t.id === theme.id);

  const record = {
    id: theme.id,
    name: theme.name || '未命名主题',
    baseTheme: theme.baseTheme || 'light',
    variables: theme.variables || {},
    radiusScale: typeof theme.radiusScale === 'number' ? theme.radiusScale : 50,
    shadowScale: typeof theme.shadowScale === 'number' ? theme.shadowScale : 100,
    createdAt: idx !== -1 ? list[idx].createdAt : now,
    updatedAt: now,
  };

  if (idx !== -1) list[idx] = record;
  else list.push(record);

  writeAll(list);
  return record;
}

export function deleteCustomTheme(id) {
  if (!id) return;
  const list = readAll().filter(t => t.id !== id);
  writeAll(list);
}

export function clearAllCustomThemes() {
  try { localStorage.removeItem(STORAGE_KEY); } catch (_) {}
}

export function generateCustomThemeId() {
  const ts = Date.now();
  const rand = Math.random().toString(36).slice(2, 8);
  return `${CUSTOM_ID_PREFIX}${ts}-${rand}`;
}

export function isCustomThemeId(id) {
  return typeof id === 'string' && id.startsWith(CUSTOM_ID_PREFIX);
}

export default {
  getCustomThemes,
  getCustomTheme,
  saveCustomTheme,
  deleteCustomTheme,
  clearAllCustomThemes,
  generateCustomThemeId,
  isCustomThemeId,
};