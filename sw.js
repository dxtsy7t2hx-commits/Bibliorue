// Service worker : interface disponible hors ligne (les données viennent de Supabase, en ligne).
const CACHE = 'bibliorue-v3.1.1';
const SHELL = [
  './', 'index.html', 'css/style.css', 'manifest.webmanifest',
  'js/app.js', 'js/api.js', 'js/config.js', 'vendor/supabase-js-2.118.0.js', 'js/geo.js', 'js/isbn.js', 'js/overpass.js', 'js/openlibrary.js', 'js/route.js',
  'icons/icon.svg', 'icons/icon-192.png', 'icons/icon-512.png',
  'fonts/lilita-one-latin-400-normal.woff2', 'fonts/lilita-one-latin-ext-400-normal.woff2',
  'fonts/nunito-latin-wght-normal.woff2', 'fonts/nunito-latin-ext-wght-normal.woff2', 'fonts/nunito-latin-wght-italic.woff2',
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
  // Seule l'interface (même site + Leaflet) passe par ce cache ; les appels à Supabase vont au réseau.
  if (url.origin !== location.origin && url.hostname !== 'unpkg.com') return;
  // « Réseau d'abord, cache en secours » : toujours la dernière version quand on est en ligne.
  e.respondWith(
    fetch(req)
      .then((res) => {
        if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
        return res;
      })
      .catch(async () => (await caches.match(req, { ignoreSearch: true })) || caches.match('index.html')),
  );
});
