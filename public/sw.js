// public/sw.js
// 应用外壳（app-shell）缓存：让 TWA 后台被系统杀掉渲染进程后，再点开也能从 SW 缓存秒开，
// 只有 WebSocket 需要重连 —— 体验对齐以前纯网页端（bfcache 冻结恢复）的「只重连终端、页面不刷新」速度。
// 注意：本 SW 不缓存 WebSocket / 非 GET 请求（命令与终端数据流照常走网络）。
// 缓存策略 stale-while-revalidate：先吐缓存保证秒开，同时后台回源刷新，下次冷启动即为最新。
// v1 曾用纯 cache-first，命中就永不回源，前端改动永远到不了客户端（改了像没改），已废弃。

const CACHE = 'remote-cmd-shell-v51';  // 须与 index.html 的 APP_VERSION 保持一致（同源单用户，统一一个版本号便于管理）
const SHELL = [
  './',
  './index.html',
  './styles.css',
  './manifest.webmanifest',
  './term-session.js',
  './xterm/lib/xterm.js',
  './xterm/css/xterm.css',
  './addon-web-links/lib/addon-web-links.js',
  './addon-unicode11/lib/addon-unicode11.js',
  './icon-192.png',
  './icon-512.png',
  './icon-maskable-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE)
      .then((c) => c.addAll(SHELL))
      .then(() => self.skipWaiting()) // 新版本就绪立即激活，避免旧缓存长期驻留
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
      .then(() => self.clients.matchAll({type:'window'}).then(function(cs){ cs.forEach(function(c){ try{ c.postMessage({cache: CACHE}); }catch(e){} }); }))
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return; // 非 GET（含命令 POST、WS 升级）直接走网络，SW 不拦截

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // 跨域资源不拦截

  // 接口一律走网络：auth-check 等 GET 接口若被缓存，会永远返回首次结果。
  if (url.pathname.includes('/api/')) return;

  // 导航请求归一化缓存 key：
  // 仅 scope 根路径（如 /cmd/）复用 ./index.html 缓存条目（与 SHELL 预缓存一致）。
  // 其他导航请求（如 /cmd/login）按自身 URL 独立缓存，
  // 避免登录页内容被错误写入 index.html 的缓存条目。
  const scopePath = new URL('./', self.location.href).pathname;
  const isRootNav = req.mode === 'navigate' &&
      (url.pathname === scopePath || url.pathname === scopePath + 'index.html');
  const key = isRootNav ? './index.html' : req;

  event.respondWith(
    caches.match(key).then((cached) => {
      const fresh = fetch(req).then((res) => {
        // 跳过重定向响应：未登录时 /cmd/ 被 302 到 /cmd/login，
        // 若写入缓存会用 login.html 内容覆盖 index.html 条目。
        if (res.ok && !res.redirected) {
          const copy = res.clone();
          return caches.open(CACHE).then((c) => c.put(key, copy)).then(() => res);
        }
        return res;
      });
      // 有缓存就立即返回（秒开），同时后台拉新写回；没缓存才等网络。
      if (cached) {
        // waitUntil 延长 SW 存活，否则后台刷新可能来不及写入就被终止。
        // 后台刷新失败（离线）无妨，下次冷启动再试。
        event.waitUntil(fresh.catch(() => {}));
        return cached;
      }
      return fresh;
    })
  );
});
