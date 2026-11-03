/* Only the application shell is cached. Form values never enter this worker. */
const CACHE_VERSION = '2026-11-03-v1.1.0';
const SCOPE = new URL(self.registration.scope);
const CACHE_PREFIX = `invigilation-shell:${SCOPE.pathname}:`;
const CACHE_NAME = `${CACHE_PREFIX}${CACHE_VERSION}`;
const SHELL_PATHS = [
  './',
  './index.html',
  './styles.css',
  './src/app.js',
  './src/calculator.js',
  './src/plan-image.js',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png',
];
const SHELL_URLS = new Set(SHELL_PATHS.map((path) => new URL(path, SCOPE).href));

self.addEventListener('install', (event) => {
  // addAll commits only when every shell resource was fetched successfully.
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(
    [...SHELL_URLS].map((url) => new Request(url, { cache: 'reload' })),
  )));
  // An update stays waiting so an open calculation is never reset by deployment.
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names
      .filter((name) => name.startsWith(CACHE_PREFIX) && name !== CACHE_NAME)
      .map((name) => caches.delete(name)));
    await self.clients.claim();
  })());
});

self.addEventListener('message', (event) => {
  // The page sends this only after an explicit user update action.
  if (event.data?.type === 'ACTIVATE_UPDATE') event.waitUntil(self.skipWaiting());
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (url.origin !== SCOPE.origin) return;
  // Query strings are not stored; only known static resource URLs are served.
  url.search = '';
  url.hash = '';
  if (!SHELL_URLS.has(url.href)) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    const cached = await cache.match(url.href);
    // No runtime cache writes: this cannot store inputs, exports or API replies.
    return cached || fetch(event.request);
  })());
});
