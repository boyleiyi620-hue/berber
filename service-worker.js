const CACHE_NAME = 'berber-pwa-v3';
const APP_SHELL = [
  './',
  './index.html',
  './admin.html',
  './offline.html',
  './styles.css',
  './booking.js',
  './admin.js',
  './config.js',
  './pwa.js',
  './manifest.webmanifest',
  './admin.webmanifest',
  './icons/customer-192.png',
  './icons/customer-512.png',
  './icons/admin-192.png',
  './icons/admin-512.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((key) => key.startsWith('berber-pwa-') && key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin) return;

  const scopePath = new URL(self.registration.scope).pathname;
  if (!url.pathname.startsWith(scopePath)) return;

  if (request.mode === 'navigate') {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE_NAME);
      try {
        const response = await fetch(request);
        if (response.ok) {
          const cacheKey = new Request(`${url.origin}${url.pathname}`);
          await cache.put(cacheKey, response.clone());
        }
        return response;
      } catch {
        const cachedPage = await cache.match(request, { ignoreSearch: true });
        return cachedPage || cache.match(new URL('./offline.html', self.registration.scope).href);
      }
    })());
    return;
  }

  const isAppAsset = APP_SHELL.some((path) => new URL(path, self.registration.scope).pathname === url.pathname);
  if (!isAppAsset) return;

  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    try {
      const response = await fetch(request);
      if (response.ok) await cache.put(request, response.clone());
      return response;
    } catch {
      const cachedAsset = await cache.match(request, { ignoreSearch: true });
      return cachedAsset || Response.error();
    }
  })());
});
