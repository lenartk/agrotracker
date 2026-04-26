// Service worker za AgroTracker v2
// Strategija:
//   - App shell (HTML/CSS/JS/Leaflet) — cache-first, za offline delovanje
//   - Zemljevid tile-i — network-first z dolgotrajnim cache-om (za parcele, ki si jih že obiskal)
//   - Vse ostalo — cache-first z network fallback-om

const APP_CACHE = 'agrotracker-app-v3';
const TILE_CACHE = 'agrotracker-tiles-v1';

const SHELL = [
  './',
  './index.html',
  './manifest.json',
  './css/app.css',
  './js/app.js',
  './js/constants.js',
  './js/geo.js',
  './js/storage.js',
  './js/ble.js',
  './js/gps.js',
  './js/map.js',
  './js/session.js',
  './js/offline.js',
  './data/demo-parcels.geojson',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './vendor/leaflet.js',
  './vendor/leaflet.css'
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(APP_CACHE).then(c => c.addAll(SHELL).catch(err => {
      console.warn('SW cache.addAll partial fail', err);
    })).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(
      keys.filter(k => k !== APP_CACHE && k !== TILE_CACHE).map(k => caches.delete(k))
    )).then(() => self.clients.claim())
  );
});

function isTileRequest(url){
  return /tile\.openstreetmap\.org/.test(url) ||
         /arcgisonline\.com/.test(url);
}

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);

  if (isTileRequest(url.href)){
    // Zemljevid — cache + mrežna osvežitev
    e.respondWith(
      caches.open(TILE_CACHE).then(cache =>
        cache.match(e.request).then(cached => {
          const fetchPromise = fetch(e.request).then(resp => {
            // Sprejmemo tudi opaque (mode: 'no-cors' brez CORS header-jev)
            if (resp && (resp.ok || resp.type === 'opaque')) cache.put(e.request, resp.clone());
            return resp;
          }).catch(() => cached);
          return cached || fetchPromise;
        })
      )
    );
    return;
  }

  // Za app shell: cache-first, potem network + update
  e.respondWith(
    caches.match(e.request).then(cached => {
      if (cached) return cached;
      return fetch(e.request).then(resp => {
        if (resp && resp.ok && url.origin === location.origin){
          const copy = resp.clone();
          caches.open(APP_CACHE).then(c => c.put(e.request, copy)).catch(()=>{});
        }
        return resp;
      }).catch(() => cached);
    })
  );
});
