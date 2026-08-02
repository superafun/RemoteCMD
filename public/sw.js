// public/sw.js
// 应用外壳（app-shell）缓存：让 TWA 后台被系统杀掉渲染进程后，再点开也能从 SW 缓存秒开，
// 只有 WebSocket 需要重连 —— 体验对齐以前纯网页端（bfcache 冻结恢复）的「只重连终端、页面不刷新」速度。
// 注意：本 SW 不缓存 WebSocket / 非 GET 请求（命令与终端数据流照常走网络）。

const CACHE = 'remote-cmd-shell-v1';
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
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return; // 非 GET（含命令 POST、WS 升级）直接走网络，SW 不拦截

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // 跨域资源不拦截

  // 文档导航：缓存优先，未命中再走网络并回填。保证 TWA 重载秒开。
  if (req.mode === 'navigate') {
    event.respondWith(
      caches.match('./index.html').then((cached) => {
        if (cached) return cached;
        return fetch(req).then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put('./index.html', copy));
          }
          return res;
        });
      })
    );
    return;
  }

  // 静态资源：缓存优先，未命中拉网络并写缓存（cache-first）。
  event.respondWith(
    caches.match(req).then((cached) => {
      if (cached) return cached;
      return fetch(req).then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
        }
        return res;
      });
    })
  );
});
