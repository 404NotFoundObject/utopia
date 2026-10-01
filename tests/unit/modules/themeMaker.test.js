import { describe, it, expect } from 'vitest';
import { isValidColorValue, validateImportedTheme } from '../../../js/ui/themes/themeMaker.js';

describe('modules/themeMaker · 主题导入校验 (P2-22)', () => {
  describe('isValidColorValue', () => {
    it('接受 hex 颜色', () => {
      expect(isValidColorValue('#ffffff')).toBe(true);
      expect(isValidColorValue('#FFF')).toBe(true);
      expect(isValidColorValue('#ff00ff80')).toBe(true);
    });

    it('接受 rgb/rgba/hsl/hsla', () => {
      expect(isValidColorValue('rgb(255, 0, 0)')).toBe(true);
      expect(isValidColorValue('rgba(0, 0, 0, 0.5)')).toBe(true);
      expect(isValidColorValue('hsl(120, 50%, 50%)')).toBe(true);
    });

    it('接受命名色', () => {
      expect(isValidColorValue('red')).toBe(true);
      expect(isValidColorValue('darkblue')).toBe(true);
    });

    it('拒绝 url() 与表达式（信标注入）', () => {
      expect(isValidColorValue('url(https://evil.com/beacon.png)')).toBe(false);
      expect(isValidColorValue('red; } body { display:none')).toBe(false);
      expect(isValidColorValue('red {')).toBe(false);
    });

    it('拒绝非字符串与空值', () => {
      expect(isValidColorValue(123)).toBe(false);
      expect(isValidColorValue('')).toBe(false);
      expect(isValidColorValue(null)).toBe(false);
    });
  });

  describe('validateImportedTheme', () => {
    it('只接受 COLOR_GROUPS 白名单内的键', () => {
      const result = validateImportedTheme({
        baseTheme: 'light',
        variables: {
          '--color-bg-primary': '#111111',
          '--evil-var': 'url(https://evil.com/x)',
          '--color-primary': '#ff0000',
        },
      });
      expect(result).not.toBeNull();
      expect(result.variables['--color-bg-primary']).toBe('#111111');
      expect(result.variables['--color-primary']).toBe('#ff0000');
      // 白名单外的键被丢弃
      expect('--evil-var' in result.variables).toBe(false);
    });

    it('白名单内但值为非颜色的键也被丢弃', () => {
      const result = validateImportedTheme({
        baseTheme: 'light',
        variables: {
          '--color-bg-primary': 'url(https://evil.com/beacon)',
          '--color-primary': '#00ff00',
        },
      });
      expect(result.variables['--color-primary']).toBe('#00ff00');
      expect('--color-bg-primary' in result.variables).toBe(false);
    });

    it('跳过 radius/shadow 变量', () => {
      const result = validateImportedTheme({
        baseTheme: 'light',
        variables: {
          '--radius-full': '999px',
          '--shadow-md': '0 2px 8px rgba(0,0,0,0.1)',
          '--color-primary': '#ff0000',
        },
      });
      expect('--radius-full' in result.variables).toBe(false);
      expect('--shadow-md' in result.variables).toBe(false);
      expect(result.variables['--color-primary']).toBe('#ff0000');
    });

    it('无 variables 或 baseTheme 时返回 null', () => {
      expect(validateImportedTheme(null)).toBeNull();
      expect(validateImportedTheme({})).toBeNull();
      expect(validateImportedTheme('string')).toBeNull();
    });

    it('radiusScale/shadowScale 做范围钳制', () => {
      const result = validateImportedTheme({
        baseTheme: 'light',
        variables: {},
        radiusScale: 999,
        shadowScale: -5,
      });
      expect(result.radiusScale).toBe(100);
      expect(result.shadowScale).toBe(0);
    });
  });
});
