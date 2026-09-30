/* ============================================================
   Utopia Service Worker（PWA）
   - 递归预缓存：页面注册成功后发来指令，从 index.html 出发解析
     HTML 资源引用、importmap、JS 静态/动态导入与资源字符串、
     CSS url()，把全部同源代码一次入缓存——离线首启即可用
     （含按需导入的功能模块）；自动化测试环境不发指令、不爬取
   - 同源静态资源：stale-while-revalidate（先回缓存，后台刷新），
     兜底覆盖动态拼接等静态分析不到的路径
   - 页面导航：网络优先，离线时回退 index.html（应用壳）
   - 第三方资源（CDN 库、用户配置的 AI API）一律不拦截不缓存
   缓存按版本命名，激活时清理旧版本；更新 CACHE_VERSION 并
   重新发布 sw.js 即可触发客户端升级。
   ============================================================ */

const CACHE_VERSION = 'v2';
const CACHE_NAME = `utopia-static-${CACHE_VERSION}`;
const APP_SHELL = ['./', './index.html'];
const MAX_PRECACHE = 500;

/* ============================================================
   递归预缓存
   动态 import() 的模块只有在线加载过一次才会进运行期缓存，
   离线首启即失效；这里静态爬取全部同源资源补齐。
   ============================================================ */

const ASSET_EXT_RE =
  /\.(?:png|jpe?g|gif|svg|webp|ico|bmp|mp3|wav|ogg|m4a|aac|json|txt|vtt|css|mjs|woff2?|ttf|otf)$/i;
const PARSEABLE_EXT_RE = /\.(?:js|mjs|css|html)$/i;

/* 同源且为 http(s) 的 URL 才允许进缓存 */
function sameOriginUrl(raw, base) {
  if (!raw || /^(?:data:|blob:|javascript:|mailto:|tel:|#)/i.test(raw)) return null;
  try {
    const u = new URL(raw, base);
    if (u.origin !== self.location.origin) return null;
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    return u;
  } catch (_) {
    return null;
  }
}

/* 解析 importmap（含前缀键），把裸说明符换成真实路径 */
function resolveSpec(spec, importMap) {
  const imports = importMap && importMap.imports;
  if (!imports) return spec;
  if (imports[spec]) return imports[spec];
  for (const key of Object.keys(imports)) {
    if (key.endsWith('/') && spec.startsWith(key)) {
      return imports[key] + spec.slice(key.length);
    }
  }
  return spec;
}

function extractFromHtml(html) {
  const found = [];
  let m;
  const attrRe = /(?:\bsrc|\bhref)\s*=\s*["']([^"']+)["']/gi;
  while ((m = attrRe.exec(html))) found.push(m[1]);
  // importmap 的目标值即真实资源路径
  const mapRe = /<script[^>]*type=["']importmap["'][^>]*>([\s\S]*?)<\/script>/gi;
  while ((m = mapRe.exec(html))) {
    try {
      const map = JSON.parse(m[1]);
      for (const v of Object.values((map && map.imports) || {})) found.push(v);
    } catch (_) { /* importmap 损坏时跳过 */ }
  }
  return found;
}

function extractFromJs(text) {
  const found = [];
  let m;
  // 静态 import / 动态 import() / re-export 的模块说明符
  const specRe = /(?:import\s*\(\s*|\bfrom\s+|\bimport\s+)["']([^"'\n]+)["']/g;
  while ((m = specRe.exec(text))) found.push(m[1]);
  // fetch('...') / new Audio('...') 等资源字符串
  const litRe = /["']([^"'\n]{2,300})["']/g;
  while ((m = litRe.exec(text))) {
    const s = m[1];
    if (s.includes('/') && !s.includes(' ') && ASSET_EXT_RE.test(s)) found.push(s);
  }
  return found;
}

function extractFromCss(text) {
  const found = [];
  let m;
  const urlRe = /url\(\s*["']?([^"')]+?)["']?\s*\)/gi;
  const importRe = /@import\s+(?:url\(\s*)?["']([^"')]+)["']/gi;
  while ((m = urlRe.exec(text))) found.push(m[1]);
  while ((m = importRe.exec(text))) found.push(m[1]);
  return found;
}

async function precacheAppAssets(cache) {
  const entry = new URL('./index.html', self.location.origin).href;
  const seen = new Set([entry]);
  const queue = [entry];
  const responses = [];
  let importMap = null;

  while (queue.length && responses.length < MAX_PRECACHE) {
    const url = queue.shift();
    // 逐文件让出主线程，预缓存不与页面交互抢资源
    await new Promise((resolve) => setTimeout(resolve, 0));
    let res;
    try {
      res = await fetch(url, { credentials: 'same-origin', cache: 'no-cache' });
    } catch (_) {
      continue;
    }
    if (!res || !res.ok) continue;
    responses.push(res);

    const type = res.headers.get('content-type') || '';
    if (!/text|javascript|json|ecmascript/i.test(type)) continue;
    const text = await res.clone().text().catch(() => '');
    if (!text) continue;

    let refs = [];
    if (url === entry) {
      refs = extractFromHtml(text);
      // 记录 importmap，供后续 JS 的裸说明符解析
      const mapRe = /<script[^>]*type=["']importmap["'][^>]*>([\s\S]*?)<\/script>/i;
      const m = text.match(mapRe);
      if (m) {
        try {
          importMap = JSON.parse(m[1]);
        } catch (_) { /* 解析失败按无 importmap 处理 */ }
      }
    } else if (/javascript|ecmascript/i.test(type)) {
      refs = extractFromJs(text).map((s) => resolveSpec(s, importMap));
    } else if (/css/i.test(type)) {
      refs = extractFromCss(text);
    }

    for (const raw of refs) {
      const u = sameOriginUrl(raw, url);
      if (!u) continue;
      const path = u.pathname;
      if (!PARSEABLE_EXT_RE.test(path) && !ASSET_EXT_RE.test(path)) continue;
      if (seen.has(u.href)) continue;
      seen.add(u.href);
      if (queue.length + responses.length < MAX_PRECACHE) queue.push(u.href);
    }
  }

  await Promise.allSettled(responses.map((res) => cache.put(res.url, res)));
}

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    await cache.addAll(APP_SHELL).catch(() => {});
    await self.skipWaiting();
  })());
});

/* 预缓存由页面消息驱动（js/pwa.js 注册成功后发送）：不阻塞安装与激活，
   自动化测试环境（navigator.webdriver）不发消息，避免拖慢冷启动。
   重复消息用模块级标志去重，多标签页同时打开也只爬一次。 */
let precaching = false;
self.addEventListener('message', (event) => {
  if (!event.data || event.data.type !== 'precache' || precaching) return;
  precaching = true;
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    await precacheAppAssets(cache).catch(() => {});
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  // 跨域请求（CDN 第三方库 / 用户配置的 AI API）不拦截
  if (url.origin !== self.location.origin) return;

  // 页面导航：网络优先，离线回退应用壳
  if (req.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const fresh = await fetch(req);
        // 仅应用入口导航刷新壳缓存，避免把 404 页等存成入口
        const rootPath = new URL('./', self.location.origin).pathname;
        if (fresh.ok && (url.pathname === rootPath || url.pathname.endsWith('/index.html'))) {
          const cache = await caches.open(CACHE_NAME);
          cache.put('./index.html', fresh.clone()).catch(() => {});
        }
        return fresh;
      } catch (_) {
        const cache = await caches.open(CACHE_NAME);
        return (
          (await cache.match('./index.html')) ||
          (await cache.match('./')) ||
          Response.error()
        );
      }
    })());
    return;
  }

  // 同源静态资源：stale-while-revalidate
  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    const cached = await cache.match(req);
    const network = fetch(req)
      .then((res) => {
        if (res && res.ok) cache.put(req, res.clone()).catch(() => {});
        return res;
      })
      .catch(() => cached);
    return cached || network;
  })());
});
