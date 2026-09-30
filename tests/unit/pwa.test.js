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
    // 键盘弹出时收缩布局视口：WEBAPK 与浏览器快捷方式行为一致
    expect(html).toContain('interactive-widget=resizes-content');
    // 窗口装饰器样式表须在 wechat.css 之后，保证变量覆盖顺序一致
    expect(html).toContain('css/titlebar.css');
    expect(html.indexOf('css/titlebar.css')).toBeGreaterThan(html.indexOf('css/wechat.css'));
  });

  test('sw.js 递归预缓存同源资源（覆盖动态导入模块），由页面消息驱动', () => {
    const sw = readFileSync(resolve(root, 'sw.js'), 'utf-8');
    expect(sw).toContain('precacheAppAssets');
    expect(sw).toContain('importmap');
    expect(sw).toMatch(/import\s*\(\s*/);
    expect(sw).toContain('MAX_PRECACHE');
    // 预缓存不阻塞安装，由页面消息触发（自动化环境不发消息）
    expect(sw).toContain("addEventListener('message'");
    expect(sw).toMatch(/type !== 'precache'/);
    // 资源引用过滤：只收同源 http(s)
    expect(sw).toMatch(/origin !== self\.location\.origin/);
    const pwa = readFileSync(resolve(root, 'js/pwa.js'), 'utf-8');
    expect(pwa).toMatch(/type: 'precache'/);
    expect(pwa).toContain('webdriver');
  });

  test('移动端键盘弹出由布局视口收缩承载', () => {
    const css = readFileSync(resolve(root, 'css/layout.css'), 'utf-8');
    expect(css).toContain('100dvh');
  });

  test('manifest 声明窗口控件叠加，桌面窗口顶栏交由页面自绘', () => {
    const manifest = JSON.parse(readFileSync(resolve(root, 'manifest.json'), 'utf-8'));
    expect(Array.isArray(manifest.display_override)).toBe(true);
    expect(manifest.display_override[0]).toBe('window-controls-overlay');
    // 叠加层不可用时应退回独立窗口，而不是 browser
    expect(manifest.display_override).toContain('standalone');
  });
});

/**
 * 窗口装饰器（Window Controls Overlay）
 * 颜色由页面自绘、跟随主题；磨砂玻璃参数可在设置里调整。
 */
describe('窗口装饰器（WCO）', () => {
  test('titlebar.css 只在 WCO 模式生效，并提供拖动区与磨砂层', () => {
    const css = readFileSync(resolve(root, 'css/titlebar.css'), 'utf-8');
    expect(css).toContain('env(titlebar-area-height');
    expect(css).toContain('-webkit-app-region: drag');
    expect(css).toContain('backdrop-filter');
    expect(css).toContain('--pwa-glass-alpha');
    expect(css).toContain('color-mix(');
    // 默认隐藏：非 WCO 场景不得改变任何外观
    expect(css).toMatch(/#pwaTitleBar\s*\{\s*display:\s*none/);
  });

  test('装饰条底色通过 var() 间接引用主题色，切主题即换色', () => {
    const js = readFileSync(resolve(root, 'js/pwa.js'), 'utf-8');
    expect(js).toContain("'--color-bg-secondary'");
    expect(js).toContain('setProperty(\'--pwa-titlebar-bg\', `var(${colorVar})`)');
  });

  test('主题切换监听在 __eventBus 延迟挂载时仍能补挂', () => {
    const js = readFileSync(resolve(root, 'js/pwa.js'), 'utf-8');
    expect(js).toContain('window.__eventBus');
    expect(js).toContain('setInterval');
  });

  test('偏好写入后立即生效并做区间裁剪', async () => {
    const mod = await import('../../js/pwa.js');

    expect(document.getElementById('pwaTitleBar')).toBeTruthy();

    mod.setTitlebarPrefs({ glass: true, alpha: 0.5, blur: 12, color: 'input' });
    const style = document.documentElement.style;
    expect(style.getPropertyValue('--pwa-glass-alpha').trim()).toBe('0.5');
    expect(style.getPropertyValue('--pwa-glass-blur').trim()).toBe('12px');
    expect(style.getPropertyValue('--pwa-titlebar-bg').trim()).toBe('var(--color-bg-input)');
    expect(document.documentElement.dataset.wcoGlass).toBe('on');

    // 越界值裁剪到合法区间；非法取色回退到默认
    mod.setTitlebarPrefs({ alpha: 9, blur: -3, color: 'sidebar' });
    mod.setTitlebarPrefs({ alpha: 0.8, blur: 12, color: 'not-a-color' });
    const prefs = mod.getTitlebarPrefs();
    expect(prefs.alpha).toBe(0.8);
    expect(prefs.blur).toBe(12);
    expect(prefs.color).toBe('input');

    // 关掉玻璃后回到不透明
    mod.setTitlebarPrefs({ glass: false });
    expect(document.documentElement.dataset.wcoGlass).toBe('off');
  });
});
