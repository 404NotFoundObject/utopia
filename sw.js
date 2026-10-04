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
   - version.json：版本探测通道，**永不缓存**（网络直通），否则
     「装在缓存里的版本文件」与 manual 检查形成鸡生蛋，永远探测不到新版本
   缓存名按版本命名（安装时读 version.json 推导）；解析失败回退常量，
   激活时清理旧版本缓存。
   ============================================================ */

/* version.json 探测不到时的兜底缓存名。正常情况下用不到。 */
const FALLBACK_CACHE_VERSION = 'v2';

/* 永不进缓存的路径前缀/文件名。这些必须是「每次都问网络」的活数据。 */
const NEVER_CACHE_FILES = ['version.json'];

/* 当前生效的缓存名（install 时解析一次，供 message/fetch 复用） */
let ACTIVE_CACHE_NAME = `utopia-static-${FALLBACK_CACHE_VERSION}`;

function isNeverCached(url) {
  if (!url || !url.pathname) return false;
  return NEVER_CACHE_FILES.some((name) => url.pathname.endsWith(`/${name}`) || url.pathname === `/${name}`);
}

/* 缓存名来自 version.json 的版本号：发版改一次 version.json，
   客户端就自动换一个新缓存桶，旧资源随之作废（不再依赖手工改常量）。 */
async function resolveCacheName() {
  try {
    const res = await fetch(new URL('./version.json', self.location.href), { cache: 'no-store' });
    if (!res.ok) return ACTIVE_CACHE_NAME;
    const data = await res.json();
    const raw = data && typeof data.version === 'string' ? data.version.trim() : '';
    if (!raw) return ACTIVE_CACHE_NAME;
    const slug = raw.replace(/[^0-9A-Za-z.]/g, '-');
    return `utopia-static-v${slug}`;
  } catch (_) {
    return ACTIVE_CACHE_NAME; // 离线安装：沿用兜底名
  }
}
const APP_SHELL = ['./', './index.html'];
// 不被页面静态引用、需显式补进预缓存的资源：
// css/wechat.css 已改按需加载（wechatTheme.js 激活时注入 link），
// 从 index.html 出发的爬取不再能发现它，离线切微信主题会缺样式
const EXTRA_PRECACHE = ['css/wechat.css'];
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
  for (const extra of EXTRA_PRECACHE) {
    const u = sameOriginUrl(extra, entry);
    if (u && !seen.has(u.href)) {
      seen.add(u.href);
      queue.push(u.href);
    }
  }
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
      // 版本通道必须每次问网络，预缓存里绝不能出现它
      if (isNeverCached(u)) continue;
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
    ACTIVE_CACHE_NAME = await resolveCacheName();
    const cache = await caches.open(ACTIVE_CACHE_NAME);
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
    const cache = await caches.open(ACTIVE_CACHE_NAME);
    await precacheAppAssets(cache).catch(() => {});
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k !== ACTIVE_CACHE_NAME).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  // 跨域请求（CDN 第三方库 / 用户配置的 AI API）不拦截
  if (url.origin !== self.location.origin) return;

  // 版本探测通道：网络直通，不读也不写缓存。
  // 一旦它进了缓存，坐等版本号变新的检查就永远看不到新版本。
  if (isNeverCached(url)) {
    event.respondWith(fetch(req, { cache: 'no-store' }));
    return;
  }

  // 页面导航：网络优先，离线回退应用壳
  if (req.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const fresh = await fetch(req);
        // 仅应用入口导航刷新壳缓存，避免把 404 页等存成入口
        const rootPath = new URL('./', self.location.origin).pathname;
        if (fresh.ok && (url.pathname === rootPath || url.pathname.endsWith('/index.html'))) {
          const cache = await caches.open(ACTIVE_CACHE_NAME);
          cache.put('./index.html', fresh.clone()).catch(() => {});
        }
        return fresh;
      } catch (_) {
        const cache = await caches.open(ACTIVE_CACHE_NAME);
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
    const cache = await caches.open(ACTIVE_CACHE_NAME);
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
