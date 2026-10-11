/* ==========================================================
   豆米小站 · Service Worker（第十期 PWA）
   作用：让「添加到主屏幕」能装成真 app + 断网时页面照样能打开
   策略：网络优先——有网永远拿最新版（改代码立刻生效），
        断网才读缓存兜底；缓存成功过的资源顺手存一份
   只管本站自己的文件；Supabase 等 https 接口请求一律不碰
   ========================================================== */

// 缓存版本号：以后改了要强刷缓存，把 v1 改成 v2 即可
const CACHE_NAME = "doumi-v1";

// 安装时预存的核心文件（全是本站自己的，一个都不能 404）
const CORE_ASSETS = [
  "./",
  "./index.html",
  "./style.css",
  "./config.js",
  "./cloud.js",
  "./health.js",
  "./splash.js",
  "./app.js",
  "./manifest.json",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
];

// 安装：把核心文件存进缓存
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(CORE_ASSETS))
  );
  self.skipWaiting(); // 新 SW 立刻上岗，不等旧的下线
});

// 激活：清掉旧版本的缓存
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      )
    )
  );
  self.clients.claim(); // 让已经打开的页面马上受新 SW 管
});

// 拦截页面请求：同源 GET 才处理，其他（如 Supabase 接口）直接放行
self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET" || !request.url.startsWith(self.location.origin)) {
    return;
  }

  // 网络优先：成功就顺手更新缓存；失败（断网）才读缓存
  event.respondWith(
    fetch(request)
      .then((response) => {
        if (response && response.ok) {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
        }
        return response;
      })
      .catch(() => caches.match(request))
  );
});
