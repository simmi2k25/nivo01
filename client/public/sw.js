// NivoTalk service worker: keeps the last good app shell on the device so returning visitors get
// the app (with its own loader) instantly, even while a sleeping Render server wakes up.
// It never touches API or socket traffic.
const CACHE = 'nivotalk-shell-v1';
const SHELL = ['/', '/manifest.webmanifest', '/brand/badge-256.png', '/icons/favicon-64.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

const isRealHtml = (res) =>
  res && res.ok && (res.headers.get('content-type') || '').includes('text/html') && !res.headers.has('x-render-routing');

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/socket.io/')) return;

  // Page navigations: network first (short timeout), fall back to the saved shell.
  if (req.mode === 'navigate') {
    e.respondWith(
      (async () => {
        const cache = await caches.open(CACHE);
        try {
          const res = await Promise.race([
            fetch(req),
            new Promise((_, rej) => setTimeout(() => rej(new Error('slow')), 4000)),
          ]);
          // Render's own "waking up" page is HTML too — only keep our real index.html.
          const text = await res.clone().text();
          if (isRealHtml(res) && text.includes('id="boot"')) {
            cache.put('/', res.clone());
            return res;
          }
          return (await cache.match('/')) || res;
        } catch {
          return (await cache.match('/')) || fetch(req);
        }
      })(),
    );
    return;
  }

  // Hashed build assets, stickers and brand images: cache first.
  if (/^\/(assets|stickers|brand|icons)\//.test(url.pathname)) {
    e.respondWith(
      caches.open(CACHE).then(async (cache) => {
        const hit = await cache.match(req);
        if (hit) return hit;
        const res = await fetch(req);
        if (res.ok && !(res.headers.get('content-type') || '').includes('text/html')) cache.put(req, res.clone());
        return res;
      }),
    );
  }
});
