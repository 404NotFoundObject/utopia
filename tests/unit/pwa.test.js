import { describe, test, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

/**
 * PWA 资源完整性守护：manifest / Service Worker / 页面接线。
 * 图标等二进制只检查存在性，渲染效果由浏览器侧保证。
 */
describe('PWA 资源完整性', () => {
  test('manifest.json 可解析且包含必备字段与真实图标', () => {
    const manifest = JSON.parse(readFileSync(resolve(root, 'manifest.json'), 'utf-8'));
    expect(manifest.name).toBeTruthy();
    expect(manifest.short_name).toBeTruthy();
    expect(manifest.start_url).toBe('./');
    expect(manifest.display).toBe('standalone');
    expect(manifest.theme_color).toMatch(/^#[0-9a-fA-F]{6}$/);
    expect(manifest.icons.length).toBeGreaterThanOrEqual(3);
    for (const icon of manifest.icons) {
      expect(existsSync(resolve(root, icon.src))).toBe(true);
    }
  });

  test('sw.js 具备版本化缓存、安装 / 激活 / fetch 拦截', () => {
    const sw = readFileSync(resolve(root, 'sw.js'), 'utf-8');
    expect(sw).toContain('CACHE_NAME');
    expect(sw).toContain("addEventListener('install'");
    expect(sw).toContain("addEventListener('activate'");
    expect(sw).toContain("addEventListener('fetch'");
    expect(sw).toContain('skipWaiting');
    expect(sw).toContain('clients.claim');
  });

  test('sw.js 不拦截跨域请求与写请求', () => {
    const sw = readFileSync(resolve(root, 'sw.js'), 'utf-8');
    expect(sw).toMatch(/method !== 'GET'/);
    expect(sw).toMatch(/origin !== self\.location\.origin/);
  });

  test('index.html 已接线 manifest、图标与 SW 注册脚本', () => {
    const html = readFileSync(resolve(root, 'index.html'), 'utf-8');
    expect(html).toContain('rel="manifest"');
    expect(html).toContain('theme-color');
    expect(html).toContain('js/pwa.js');
  });
});
