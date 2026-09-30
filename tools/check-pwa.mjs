/**
 * PWA 自检脚本
 *
 * 用法：
 *   node tools/check-pwa.mjs                     # 默认校验 http://127.0.0.1:8080
 *   node tools/check-pwa.mjs --url https://xxx   # 校验部署后的站点
 *
 * 检查项：
 *   1. 运行环境（安全上下文：https / localhost / 127.0.0.1）
 *   2. manifest 可解析，关键字段与图标全部可访问（HTTP 200）
 *   3. Service Worker 注册 → installed → activated，scope 正确
 *   4. SW 接管后二次刷新离线仍能打开（离线应用壳）
 *   5. 可安装性信号（beforeinstallprompt）
 *   6. 窗口装饰器（装饰条挂载、底色跟随主题、WCO 模式探测）
 *
 * 退出码：0 = 全部通过；1 = 存在 ERROR 项
 */
import { chromium } from 'playwright';

const args = process.argv.slice(2);
const urlArg = args.indexOf('--url');
const BASE = urlArg >= 0 && args[urlArg + 1] ? args[urlArg + 1] : 'http://127.0.0.1:8080/';
const ORIGIN = new URL(BASE).origin;

const results = [];
function record(level, item, detail) {
  results.push({ level, item, detail });
  const tag = level === 'PASS' ? '\x1b[32m✔\x1b[0m' : level === 'WARN' ? '\x1b[33m!\x1b[0m' : '\x1b[31m✘\x1b[0m';
  console.log(`  ${tag} ${item}${detail ? `  \x1b[90m${detail}\x1b[0m` : ''}`);
}
function section(title) {
  console.log(`\n\x1b[1m${title}\x1b[0m`);
}

const browser = await chromium.launch();
const context = await browser.newContext({ baseURL: ORIGIN });
const page = await context.newPage();

const consoleErrors = [];
page.on('console', (m) => {
  if (m.type() === 'error') consoleErrors.push(m.text());
});
page.on('pageerror', (e) => consoleErrors.push(String(e)));

try {
  // ---------- 1. 运行环境 ----------
  section('1. 运行环境');
  const secure = await page.evaluate(() => window.isSecureContext).catch(() => null);
  // 未导航时 evaluate 会失败，先访问
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  const secureCtx = await page.evaluate(() => window.isSecureContext);
  const proto = await page.evaluate(() => location.protocol);
  if (secureCtx) record('PASS', '安全上下文', `${proto} · isSecureContext=true`);
  else record('ERROR', '安全上下文', `${proto} 不是安全上下文，Service Worker 不会注册（需 https 或 localhost）`);

  if (await page.evaluate(() => 'serviceWorker' in navigator)) record('PASS', '浏览器支持 Service Worker');
  else record('ERROR', '浏览器不支持 Service Worker');

  // ---------- 2. manifest ----------
  section('2. Manifest');
  const manifestUrl = await page.evaluate(
    () => document.querySelector('link[rel="manifest"]')?.href ?? null,
  );
  if (!manifestUrl) record('ERROR', 'index.html 已 link manifest', '未找到 link[rel=manifest]');
  else {
    record('PASS', 'index.html 已 link manifest', manifestUrl);
    const res = await context.request.get(manifestUrl);
    if (!res.ok()) record('ERROR', 'manifest 可访问', `HTTP ${res.status()}`);
    else {
      const m = await res.json();
      const need = ['name', 'short_name', 'start_url', 'display', 'icons'];
      const missing = need.filter((k) => !m[k]);
      if (missing.length) record('ERROR', 'manifest 必备字段', `缺少：${missing.join(', ')}`);
      else record('PASS', 'manifest 必备字段', `${m.name} · display=${m.display} · start_url=${m.start_url}`);

      const icons = Array.isArray(m.icons) ? m.icons : [];
      if (!icons.length) record('ERROR', 'manifest 图标列表', '为空');
      for (const ic of icons) {
        const href = new URL(ic.src, manifestUrl).href;
        const ir = await context.request.get(href);
        const sizeOK = ic.sizes ? true : true;
        if (!ir.ok()) record('ERROR', `图标 ${ic.src}`, `HTTP ${ir.status()}`);
        else {
          const ct = ir.headers()['content-type'] ?? '';
          const ok192 = ic.sizes?.includes('192') || ic.purpose?.includes('maskable');
          record(
            ct.startsWith('image/') ? 'PASS' : 'WARN',
            `图标 ${ic.src}`,
            `${ic.sizes ?? '?'} ${ic.purpose ?? 'any'} · ${ct} ${sizeOK && ok192 ? '' : ''}`.trim(),
          );
        }
      }
      const has192 = icons.some((i) => i.sizes?.includes('192'));
      const has512 = icons.some((i) => i.sizes?.includes('512'));
      if (!has192 || !has512) record('WARN', '建议提供 192 与 512 图标', `192=${has192} 512=${has512}`);
    }
  }

  // ---------- 3. Service Worker 生命周期 ----------
  section('3. Service Worker');
  const swState = await page.evaluate(async () => {
    if (!('serviceWorker' in navigator)) return { supported: false };
    const reg = await navigator.serviceWorker.getRegistration();
    if (!reg) {
      await new Promise((r) => setTimeout(r, 2500));
      const again = await navigator.serviceWorker.getRegistration();
      if (!again) return { supported: true, registered: false };
      return {
        supported: true,
        registered: true,
        scope: again.scope,
        active: again.active?.state ?? null,
        scriptURL: again.active?.scriptURL ?? null,
        controlled: !!navigator.serviceWorker.controller,
      };
    }
    return {
      supported: true,
      registered: true,
      scope: reg.scope,
      active: reg.active?.state ?? null,
      scriptURL: reg.active?.scriptURL ?? null,
      controlled: !!navigator.serviceWorker.controller,
    };
  });
  if (!swState.registered) record('ERROR', 'SW 注册', '未获取到 registration');
  else {
    record('PASS', 'SW 已注册', swState.scriptURL ?? '');
    if (swState.active === 'activated') record('PASS', 'SW 已激活', `scope=${swState.scope}`);
    else record('WARN', 'SW 状态', `state=${swState.active}（多为首次安装尚未接管，刷新一次即为 activated）`);
    if (swState.scope === `${ORIGIN}/`) record('PASS', 'SW scope 覆盖全站');
    else record('WARN', 'SW scope', `${swState.scope}（期望 ${ORIGIN}/）`);
  }

  // 让 SW 接管后再刷新一次，确认为 activated 且 controller 生效
  await page.reload({ waitUntil: 'networkidle' }).catch(() => {});
  await page.waitForTimeout(1200);
  const afterReload = await page.evaluate(() => {
    const reg = navigator.serviceWorker.controller;
    return { controlled: !!reg, scriptURL: reg?.scriptURL ?? null };
  });
  if (afterReload.controlled) record('PASS', 'SW 已接管页面（导航由 SW 控制）', afterReload.scriptURL ?? '');
  else record('WARN', 'SW 尚未接管', '首次安装后刷新通常即接管');

  // ---------- 4. 离线可用性 ----------
  section('4. 离线可用性（应用壳）');
  await context.setOffline(true);
  let offlineOK = false;
  let offlineNote = '';
  try {
    const resp = await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 15000 });
    const status = resp?.status() ?? 0;
    const title = await page.title().catch(() => '');
    offlineOK = !!title;
    offlineNote = `HTTP ${status} · title="${title}"`;
  } catch (e) {
    offlineNote = String(e).split('\n')[0];
  }
  await context.setOffline(false);
  if (offlineOK) record('PASS', '离线后仍能打开 shell（由 SW 提供 index.html）', offlineNote);
  else record('WARN', '离线未能打开', `${offlineNote}（离线可用性依赖 SW 缓存策略，非阻断项）`);

  // ---------- 5. 可安装性信号 ----------
  section('5. 可安装性');
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  const installSignal = await page.evaluate(async () => {
    return await new Promise((resolve) => {
      let fired = false;
      const handler = () => {
        fired = true;
        window.removeEventListener('beforeinstallprompt', handler);
        resolve({ fired: true, via: 'beforeinstallprompt' });
      };
      window.addEventListener('beforeinstallprompt', handler);
      setTimeout(() => {
        if (!fired) {
          window.removeEventListener('beforeinstallprompt', handler);
          resolve({ fired: false });
        }
      }, 4000);
    });
  });
  if (installSignal.fired) record('PASS', '触发 beforeinstallprompt（浏览器判定可安装）');
  else
    record(
      'WARN',
      '未捕获 beforeinstallprompt',
      'headless 环境常不派发该事件；真实 Chrome 中以地址栏「安装」图标为准',
    );

  // ---------- 6. 窗口装饰器 ----------
  section('6. 窗口装饰器（Window Controls Overlay）');
  const wco = await page.evaluate(() => ({
    manifestHasWco: null, // 由下方请求补齐
    barExists: !!document.getElementById('pwaTitleBar'),
    dataWco: document.documentElement.dataset.wco ?? null,
    dataGlass: document.documentElement.dataset.wcoGlass ?? null,
    titlebarBg: document.documentElement.style.getPropertyValue('--pwa-titlebar-bg').trim(),
    glassAlpha: document.documentElement.style.getPropertyValue('--pwa-glass-alpha').trim(),
    metaThemeColor: document.querySelector('meta[name="theme-color"]')?.getAttribute('content') ?? null,
    themeBg: getComputedStyle(document.documentElement)
      .getPropertyValue('--color-bg-secondary')
      .trim(),
    cssLoaded: [...document.styleSheets].some((s) => (s.href || '').includes('titlebar.css')),
  }));

  if (wco.barExists) record('PASS', '窗口装饰条已挂载（#pwaTitleBar，非 WCO 模式下由 CSS 隐藏）');
  else record('ERROR', '窗口装饰条未挂载', 'js/pwa.js 未注入 #pwaTitleBar');

  if (wco.cssLoaded) record('PASS', 'titlebar.css 已加载');
  else record('ERROR', 'titlebar.css 未加载', 'index.html 未引入或路径 404');

  if (wco.titlebarBg.startsWith('var(--color-'))
    record('PASS', '装饰条底色引用主题变量（切主题即换色）', wco.titlebarBg);
  else record('WARN', '装饰条底色未取到主题变量', `当前值：${wco.titlebarBg || '(空)'}`);

  if (wco.metaThemeColor && wco.metaThemeColor.toLowerCase() === wco.themeBg.toLowerCase())
    record('PASS', 'meta theme-color 与当前主题底色一致', wco.metaThemeColor);
  else
    record(
      'WARN',
      'meta theme-color 与主题底色不一致',
      `meta=${wco.metaThemeColor} · --color-bg-secondary=${wco.themeBg}（多为首帧时序差异）`,
    );

  if (wco.dataWco === 'on')
    record('PASS', '当前处于窗口控件叠加模式', `glass=${wco.dataGlass} alpha=${wco.glassAlpha}`);
  else
    record(
      'WARN',
      '当前不在窗口控件叠加模式',
      'headless 未安装为应用；真实环境安装后打开独立窗口即自动启用',
    );

  // ---------- 控制台错误 ----------
  section('7. 控制台');
  const real = consoleErrors.filter(
    (e) => !/ERR_(NAME_NOT_RESOLVED|INTERNET_DISCONNECTED|CONNECTION|PROXY)|cdn|font|googleapis|Failed to load resource/i.test(e),
  );
  if (!real.length) record('PASS', '无与 PWA 相关的控制台错误', `（已过滤 ${consoleErrors.length} 条网络/外部资源噪声）`);
  else record('WARN', `控制台错误 ${real.length} 条`, real.slice(0, 3).join(' | '));
} finally {
  await browser.close();
}

const failed = results.filter((r) => r.level === 'ERROR');
const warned = results.filter((r) => r.level === 'WARN');
console.log(
  `\n\x1b[1m小结\x1b[0m：${results.length} 项检查，\x1b[32m${results.length - failed.length - warned.length} PASS\x1b[0m` +
    `，\x1b[33m${warned.length} WARN\x1b[0m，\x1b[31m${failed.length} ERROR\x1b[0m`,
);
console.log('');
process.exit(failed.length ? 1 : 0);
