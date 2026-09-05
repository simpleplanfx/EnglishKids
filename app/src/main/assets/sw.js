/* Service Worker —— 离线缓存，装到桌面后没网也能用 */
var CACHE = 'ekids-v1';
var ASSETS = [
  './',
  './index.html',
  './css/app.css',
  './js/store.js',
  './js/speech.js',
  './js/app.js',
  './data/words.json',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png'
];

self.addEventListener('install', function (e) {
  e.waitUntil(
    caches.open(CACHE).then(function (c) {
      return Promise.all(ASSETS.map(function (u) {
        return c.add(u).catch(function (err) { console.warn('缓存失败', u, err); });
      }));
    }).then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys().then(function (ks) {
      return Promise.all(ks.map(function (k) {
        return k === CACHE ? null : caches.delete(k);
      }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return;
  var url = new URL(req.url);

  // 有道在线发音：不走缓存，失败就降级
  if (url.hostname.indexOf('dict.youdao.com') >= 0 || url.hostname.indexOf('dict.') >= 0) return;

  // 同源资源：缓存优先，后台更新
  if (url.origin === self.location.origin) {
    e.respondWith(
      caches.match(req).then(function (hit) {
        var net = fetch(req).then(function (res) {
          if (res && res.status === 200 && res.type === 'basic') {
            var copy = res.clone();
            caches.open(CACHE).then(function (c) { c.put(req, copy); });
          }
          return res;
        }).catch(function () { return hit; });
        return hit || net;
      })
    );
  }
});
