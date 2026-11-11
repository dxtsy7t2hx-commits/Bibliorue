// Service worker : interface disponible hors ligne et dernière carte consultée en secours.
const CACHE = 'bibliorue-v2.0.0';
const SHELL = [
  './', 'index.html', 'css/style.css', 'manifest.webmanifest',
  'js/app.js', 'js/api.js', 'js/geo.js', 'js/isbn.js', 'js/overpass.js', 'js/openlibrary.js', 'js/route.js',
  'icons/icon.svg', 'icons/icon-192.png', 'icons/icon-512.png',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  const sameOrigin = url.origin === location.origin;
  // Seules les lectures publiques de la carte sont gardées en secours (jamais /api/me ni l'admin).
  const cacheableApi = sameOrigin && /^\/api\/(boxes|activity)/.test(url.pathname);
  const isShell = (sameOrigin && !url.pathname.startsWith('/api/')) || url.hostname === 'unpkg.com';
  if (!isShell && !cacheableApi) return;
  // « Réseau d'abord, cache en secours » : toujours les données fraîches quand on est en ligne.
  e.respondWith(
    fetch(req)
      .then((res) => {
        if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
        return res;
      })
      .catch(async () => {
        const hit = await caches.match(req, { ignoreSearch: !cacheableApi });
        if (hit) return hit;
        if (cacheableApi) {
          // Hors ligne et zone jamais consultée : on renvoie la dernière liste connue, quelle qu'elle soit.
          const keys = await (await caches.open(CACHE)).keys();
          const any = keys.find((k) => new URL(k.url).pathname === url.pathname);
          if (any) return caches.match(any);
        }
        return caches.match('index.html');
      }),
  );
});
