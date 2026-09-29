/* ============================================================
   Utopia Service Worker（PWA）
   - 同源静态资源：stale-while-revalidate（先回缓存，后台刷新）
   - 页面导航：网络优先，离线时回退 index.html（应用壳）
   - 第三方资源（CDN 库、用户配置的 AI API）一律不拦截不缓存
   缓存按版本命名，激活时清理旧版本；更新 CACHE_VERSION 并
   重新发布 sw.js 即可触发客户端升级。
   ============================================================ */

const CACHE_VERSION = 'v1';
const CACHE_NAME = `utopia-static-${CACHE_VERSION}`;
const APP_SHELL = ['./', './index.html'];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    await cache.addAll(APP_SHELL).catch(() => {});
    await self.skipWaiting();
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
