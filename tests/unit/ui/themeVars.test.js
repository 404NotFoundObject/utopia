import { describe, test, expect, beforeEach } from 'vitest';
import {
  applyTheme,
  getAllThemeVarKeys,
  clearInlineThemeVars,
  getThemeVariablesById,
} from '../../../js/ui/layout/theme.js';
import { THEME_PRESETS } from '../../../js/ui/themes/themePresets.js';

/**
 * 主题变量键集合与跨主题切换的残留检查。
 *
 * 主题变量通过内联样式写在 :root 上，优先级高于任何 stylesheet。
 * 键集合不一致 + 只写不清 ⇒ 从键多的主题切回键少的主题时，多出来的键会带着
 * 上一个主题的颜色留在 :root（历史缺陷：light/dark/cyberpunk 缺
 * --color-bg-card / --color-border-focus，从 wechat 切回后 .card 背景与
 * input:focus 边框仍是微信绿 / 微信白）。
 */
describe('主题变量键一致性', () => {
  const THEME_IDS = Object.keys(THEME_PRESETS);

  test('所有内置主题的变量键集合完全相同', () => {
    const reference = Object.keys(THEME_PRESETS.light.variables).sort();
    expect(reference.length).toBeGreaterThan(0);

    for (const id of THEME_IDS) {
      const keys = Object.keys(THEME_PRESETS[id].variables).sort();
      expect(keys, `主题 ${id} 的变量键应与 light 完全一致`).toEqual(reference);
    }
  });

  test('getAllThemeVarKeys 覆盖每个主题的键', () => {
    const union = getAllThemeVarKeys();
    for (const id of THEME_IDS) {
      for (const key of Object.keys(THEME_PRESETS[id].variables)) {
        expect(union).toContain(key);
      }
    }
    // 并集不应该比单个主题更多（键集合一致时两者相等）
    expect(union.slice().sort()).toEqual(Object.keys(THEME_PRESETS.light.variables).sort());
  });
});

describe('跨主题切换不残留', () => {
  const root = document.documentElement;

  beforeEach(() => {
    applyTheme('light');
  });

  // 读取 :root 内联样式的全部 CSS 变量键（排除非主题的 PWA 键）
  function inlineVarKeys() {
    const keys = [];
    for (let i = 0; i < root.style.length; i += 1) {
      const key = root.style[i];
      if (key.startsWith('--pwa-')) continue;
      keys.push(key);
    }
    return keys.sort();
  }

  test('从微信主题切回亮色，不残留微信的卡片色与聚焦色', () => {
    applyTheme('wechat');
    expect(root.style.getPropertyValue('--color-border-focus').trim()).toBe('#07c160');

    applyTheme('light');
    // 修复前：这两个键不在 light 的字典里且从未被清理，残留为微信值
    const lightVars = getThemeVariablesById('light');
    const focus = root.style.getPropertyValue('--color-border-focus').trim();
    expect(focus).toBe(String(lightVars['--color-border-focus']).trim());
    expect(focus).not.toContain('#07c160');
    expect(root.style.getPropertyValue('--color-bg-card').trim()).toBe('#ffffff');
    expect(root.getAttribute('data-theme')).toBe('light');
  });

  test('切换后 :root 上的键与目标主题的键集合一致（无多余、无缺失）', () => {
    applyTheme('wechat-dark');
    applyTheme('dark');

    const expected = Object.keys(getThemeVariablesById('dark')).sort();
    expect(inlineVarKeys()).toEqual(expected);
  });

  test('任意两个主题来回切换后，内联变量值与目标主题逐项相等', () => {
    const ids = Object.keys(THEME_PRESETS);
    for (const from of ids) {
      for (const to of ids) {
        applyTheme(from);
        applyTheme(to);
        const expected = getThemeVariablesById(to);
        for (const [key, value] of Object.entries(expected)) {
          expect(
            root.style.getPropertyValue(key).trim(),
            `${from} → ${to}: ${key} 应为目标主题的值`
          ).toBe(String(value).trim());
        }
      }
    }
  });

  test('目标主题不含某键时，applyTheme 会清掉旧值而不是留着', () => {
    // 模拟「键集合再次分叉」的未来回归：临时从 light 摘掉一个只有微信主题有的键，
    // 此时 applyTheme 必须靠清理步骤把旧值去掉，让它回落到 stylesheet 的默认值。
    const original = THEME_PRESETS.light.variables;
    const stripped = { ...original };
    delete stripped['--color-bg-card'];
    try {
      applyTheme('wechat-dark');
      expect(root.style.getPropertyValue('--color-bg-card').trim()).toBe('#1f1f1f');

      THEME_PRESETS.light.variables = stripped;
      applyTheme('light');
      expect(root.style.getPropertyValue('--color-bg-card').trim()).toBe('');
    } finally {
      THEME_PRESETS.light.variables = original;
    }
  });

  test('clearInlineThemeVars 只清主题键，不动其他内联变量', () => {
    root.style.setProperty('--pwa-titlebar-bg', 'var(--color-bg-primary)');
    applyTheme('cyberpunk');

    const removed = clearInlineThemeVars(root);
    expect(removed.length).toBeGreaterThan(0);
    // 主题键已清空
    expect(root.style.getPropertyValue('--color-primary').trim()).toBe('');
    // 非主题键保留
    expect(root.style.getPropertyValue('--pwa-titlebar-bg')).toBe('var(--color-bg-primary)');

    root.style.removeProperty('--pwa-titlebar-bg');
  });
});
