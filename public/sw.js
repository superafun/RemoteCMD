// public/sw.js
// 调试期最小 service worker：仅满足 PWA 安装条件，不缓存任何资源。
// 未来需要离线能力时，在此追加 install 预缓存 + fetch 拦截逻辑即可。

self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

// 故意不监听 fetch：所有请求直达后端，保证调试期代码变更即时生效。
