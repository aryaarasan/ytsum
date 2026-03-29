// =============================================================================
// SERVICE WORKER — sw.js
// =============================================================================
// Caching strategy:
//   App shell (index.html, manifest.json, sw.js):
//     → Cache-first: serve instantly from cache, update in background
//   Google Sheets CSV data:
//     → Network-first: always try network for fresh data,
//       fall back to cached version if offline
//
// VERSION: bump this string whenever you deploy an update.
// The activate handler will delete the old cache automatically.
// =============================================================================

const CACHE_VERSION  = 'ytdigest-v1';
const SHELL_CACHE    = CACHE_VERSION + '-shell';
const DATA_CACHE     = CACHE_VERSION + '-data';

// App shell files — cached on install, served instantly on every load
const SHELL_FILES = [
  './index.html',
  './manifest.json',
];

// ─── INSTALL: cache the app shell ───────────────────────────────────────────
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(SHELL_CACHE)
      .then(cache => cache.addAll(SHELL_FILES))
      .then(() => self.skipWaiting()) // activate immediately, don't wait for old SW to die
  );
});

// ─── ACTIVATE: delete old caches ────────────────────────────────────────────
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(key => key !== SHELL_CACHE && key !== DATA_CACHE)
          .map(key => {
            console.log('[SW] Deleting old cache:', key);
            return caches.delete(key);
          })
      )
    ).then(() => self.clients.claim()) // take control of all open tabs immediately
  );
});

// ─── FETCH: intercept requests ───────────────────────────────────────────────
self.addEventListener('fetch', event => {
  const url = event.request.url;

  // Google Sheets CSV requests → network-first
  if (url.includes('docs.google.com/spreadsheets')) {
    event.respondWith(networkFirst(event.request));
    return;
  }

  // Google Fonts → cache-first (fonts don't change)
  if (url.includes('fonts.googleapis.com') || url.includes('fonts.gstatic.com')) {
    event.respondWith(cacheFirst(event.request, SHELL_CACHE));
    return;
  }

  // App shell files → cache-first
  if (url.includes(self.location.origin)) {
    event.respondWith(cacheFirst(event.request, SHELL_CACHE));
    return;
  }

  // Everything else (thumbnails from YouTube CDN, etc.) → network with cache fallback
  event.respondWith(networkFirst(event.request));
});


// ─── STRATEGY: Network-first ─────────────────────────────────────────────────
// Try the network. If it succeeds, cache the response and return it.
// If the network fails, serve from cache. If cache misses too, return a 503.
async function networkFirst(request) {
  const cache = await caches.open(DATA_CACHE);

  try {
    const networkResponse = await fetch(request);

    // Only cache successful responses
    if (networkResponse.ok) {
      cache.put(request, networkResponse.clone());
    }

    return networkResponse;

  } catch (err) {
    // Network failed — try cache
    const cached = await cache.match(request);
    if (cached) {
      console.log('[SW] Serving from cache (offline):', request.url);
      return cached;
    }

    // Nothing in cache either
    return new Response('Offline and no cached data available.', {
      status: 503,
      statusText: 'Service Unavailable',
    });
  }
}


// ─── STRATEGY: Cache-first ───────────────────────────────────────────────────
// Serve from cache immediately if available.
// If not in cache, fetch from network and cache the result.
async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);

  if (cached) {
    return cached;
  }

  try {
    const networkResponse = await fetch(request);
    if (networkResponse.ok) {
      cache.put(request, networkResponse.clone());
    }
    return networkResponse;
  } catch (err) {
    return new Response('Resource not available offline.', {
      status: 503,
      statusText: 'Service Unavailable',
    });
  }
}
