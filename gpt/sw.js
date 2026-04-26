// Service worker za ločeno GPT testno PWA pod /gpt/.
// Namenoma ima svoj cache, da ne meša produkcijske PWA iz root-a.

const APP_CACHE = 'agrotracker-gpt-app-v1';
const TILE_CACHE = 'agrotracker-gpt-tiles-v1';

const SHELL = [
  './',
  './index.html',
  './manifest.json',
  './data/demo-parcels.geojson',
  '../css/app.css',
  '../vendor/leaflet.js',
  '../vendor/leaflet.css',
  'https://cdn.jsdelivr.net/gh/lenartk/agrotracker@gpt/js/app.js',
  'https://cdn.jsdelivr.net/gh/lenartk/agrotracker@gpt/js/constants.js',
  'https://cdn.jsdelivr.net/gh/lenartk/agrotracker@gpt/js/geo.js',
  'https://cdn.jsdelivr.net/gh/lenartk/agrotracker@gpt/js/storage.js',
  'https://cdn.jsdelivr.net/gh/lenartk/agrotracker@gpt/js/ble.js',
  'https://cdn.jsdelivr.net/gh/lenartk/agrotracker@gpt/js/gps.js',
  'https://cdn.jsdelivr.net/gh/lenartk/agrotracker@gpt/js/map.js',
  'https://cdn.jsdelivr.net/gh/lenartk/agrotracker@gpt/js/parcel-guard.js',
  'https://cdn.jsdelivr.net/gh/lenartk/agrotracker@gpt/js/session.js',
  'https://cdn.jsdelivr.net/gh/lenartk/agrotracker@gpt/js/offline.js'
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(APP_CACHE)
      .then(c => c.addAll(SHELL).catch(err => console.warn('GPT SW cache.addAll partial fail', err)))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(
      keys.filter(k => k.startsWith('agrotracker-gpt-') && k !== APP_CACHE && k !== TILE_CACHE).map(k => caches.delete(k))
    )).then(() => self.clients.claim())
  );
});

function isTileRequest(url){
  return /tile\.openstreetmap\.org/.test(url) || /arcgisonline\.com/.test(url);
}

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);

  if (isTileRequest(url.href)){
    e.respondWith(
      caches.open(TILE_CACHE).then(cache =>
        cache.match(e.request).then(cached => {
          const fresh = fetch(e.request).then(resp => {
            if (resp && (resp.ok || resp.type === 'opaque')) cache.put(e.request, resp.clone());
            return resp;
          }).catch(() => cached);
          return cached || fresh;
        })
      )
    );
    return;
  }

  e.respondWith(
    caches.match(e.request).then(cached => cached || fetch(e.request).then(resp => {
      if (resp && (resp.ok || resp.type === 'opaque')){
        caches.open(APP_CACHE).then(c => c.put(e.request, resp.clone())).catch(()=>{});
      }
      return resp;
    }).catch(() => cached))
  );
});
