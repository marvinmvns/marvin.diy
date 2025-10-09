const CACHE_NAME = 'video-wall-shell-v2';
const MAX_CACHE_AGE = 24 * 60 * 60 * 1000;
const PRECACHE_URLS = ['/', '/app.js'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(PRECACHE_URLS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            return caches.delete(key);
          }
          return null;
        })
      )
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') {
    return;
  }

  const url = new URL(request.url);

  if (url.origin !== self.location.origin) {
    return;
  }

  if (url.pathname.startsWith('/videos/') || url.pathname.startsWith('/api/likes')) {
    return;
  }

  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) {
        const cachedTime = Number(cached.headers.get('sw-cache-time')) || 0;
        if (Date.now() - cachedTime > MAX_CACHE_AGE) {
          return fetchAndCache(request, cached);
        }
        return cached;
      }

      return fetchAndCache(request);
    })
  );
});

function fetchAndCache(request, fallback) {
  return fetch(request)
    .then((response) => {
      if (response && response.ok) {
        const clone = response.clone();
        clone.blob().then((body) => {
          const headers = new Headers(clone.headers);
          headers.set('sw-cache-time', Date.now().toString());
          caches.open(CACHE_NAME).then((cache) =>
            cache.put(request, new Response(body, {
              status: clone.status,
              statusText: clone.statusText,
              headers,
            }))
          );
        });
      }
      return response;
    })
    .catch((error) => {
      if (fallback) {
        return fallback;
      }
      throw error;
    });
}
