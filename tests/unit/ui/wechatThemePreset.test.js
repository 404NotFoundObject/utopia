import { describe, test, expect } from 'vitest';
import { THEME_PRESETS, getThemeVariables } from '../../../js/ui/themes/themePresets.js';

/**
 * 微信主题（wechat / wechat-dark）预设检查。
 *
 * 主题变量由 themePresets 提供并经 applyTheme 写入内联样式，
 * 优先级高于任何 stylesheet——因此变量字典本身必须完整，
 * 缺键会导致对应元素回落到 :root 默认紫色系。
 */
describe('微信主题预设', () => {
  const WECHAT_IDS = ['wechat', 'wechat-dark'];

  test('两个微信主题均已注册且可被查询', () => {
    for (const id of WECHAT_IDS) {
      expect(THEME_PRESETS[id], `主题 ${id} 应存在`).toBeTruthy();
      expect(THEME_PRESETS[id].id).toBe(id);
      expect(THEME_PRESETS[id].name).toContain('实验');
      expect(getThemeVariables(id)).toBeTruthy();
    }
  });

  test('配色核心：品牌绿与气泡绿', () => {
    expect(getThemeVariables('wechat')['--color-primary']).toBe('#07c160');
    expect(getThemeVariables('wechat')['--color-primary-light']).toBe('#95ec69');
    expect(getThemeVariables('wechat-dark')['--color-primary']).toBe('#07c160');
    expect(getThemeVariables('wechat-dark')['--color-primary-light']).toBe('#3eb575');
  });

  test('必备变量键完整（与既有内置主题键集一致）', () => {
    const expectedKeys = Object.keys(THEME_PRESETS.light.variables);
    for (const id of WECHAT_IDS) {
      const vars = getThemeVariables(id);
      for (const key of expectedKeys) {
        expect(vars[key], `${id} 缺少 ${key}`).toBeTruthy();
      }
    }
  });

  test('圆角体系整体收紧（微信小圆角观感），但 --radius-full 保持全圆', () => {
    const vars = getThemeVariables('wechat');
    expect(vars['--radius-lg']).toBe('6px');
    expect(vars['--radius-full']).toBe('9999px');
  });
});
