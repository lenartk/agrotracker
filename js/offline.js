// Offline pomočnik: prenese tile-e za izbrane parcele za offline uporabo.
// Tile-i se shranjujejo v isti TILE_CACHE kot v service worker-ju, tako da
// so po prenosu na voljo brez interneta.

import { bboxOfFeature } from './geo.js';

// Lat/lng -> tile koordinate (Web Mercator, slippy map)
function lngToTileX(lng, z){
  return Math.floor(((lng + 180) / 360) * Math.pow(2, z));
}
function latToTileY(lat, z){
  const r = lat * Math.PI / 180;
  return Math.floor((1 - Math.log(Math.tan(r) + 1/Math.cos(r)) / Math.PI) / 2 * Math.pow(2, z));
}

// Sestavi seznam tile URL-jev za bbox in obseg zoom-ov.
// providers: 'osm' | 'sat'
export function tilesForBounds(bounds, zoomMin, zoomMax, providers = ['osm', 'sat']){
  const [[s, w], [n, e]] = bounds; // [[swLat, swLng], [neLat, neLng]]
  const urls = [];
  for (let z = zoomMin; z <= zoomMax; z++){
    const x0 = lngToTileX(w, z), x1 = lngToTileX(e, z);
    const y0 = latToTileY(n, z), y1 = latToTileY(s, z);
    for (let x = Math.min(x0, x1); x <= Math.max(x0, x1); x++){
      for (let y = Math.min(y0, y1); y <= Math.max(y0, y1); y++){
        if (providers.includes('osm')){
          // OSM ima tri subdomene a/b/c — uporabimo a
          urls.push(`https://a.tile.openstreetmap.org/${z}/${x}/${y}.png`);
        }
        if (providers.includes('sat')){
          urls.push(`https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${z}/${y}/${x}`);
        }
      }
    }
  }
  return urls;
}

// Pridobi seznam URL-jev za vse parcele
export function tilesForParcels(parcels, zoomMin = 14, zoomMax = 18, providers = ['osm', 'sat']){
  const allUrls = new Set();
  for (const p of parcels){
    const bounds = bboxOfFeature(p.feature);
    // Razširi za 50 m okoli
    const padLat = 50 / 111320;
    const padLng = 50 / (111320 * Math.cos(((bounds[0][0] + bounds[1][0]) / 2) * Math.PI / 180));
    const padded = [
      [bounds[0][0] - padLat, bounds[0][1] - padLng],
      [bounds[1][0] + padLat, bounds[1][1] + padLng]
    ];
    for (const u of tilesForBounds(padded, zoomMin, zoomMax, providers)){
      allUrls.add(u);
    }
  }
  return Array.from(allUrls);
}

// Prenesi tile-e v cache. Vrne progress callback.
// onProgress({ done, total, currentUrl, errors })
export async function downloadTiles(urls, onProgress, opts = {}){
  const concurrency = opts.concurrency || 4;
  const cache = await caches.open('agrotracker-tiles-v1');
  let done = 0, errors = 0;
  let aborted = false;
  const ac = opts.abortSignal;

  const queue = urls.slice();
  async function worker(){
    while (queue.length){
      if (aborted || (ac && ac.aborted)) return;
      const url = queue.shift();
      try {
        // Ali že imamo? Preskoči.
        const existing = await cache.match(url);
        if (!existing){
          // 'no-cors' ker ArcGIS ne nastavlja CORS header-jev, ampak za cache je opaque OK
          const resp = await fetch(url, { mode: 'no-cors', credentials: 'omit' });
          if (resp && (resp.ok || resp.type === 'opaque')){
            await cache.put(url, resp.clone());
          } else {
            errors++;
          }
        }
      } catch (e){
        errors++;
      }
      done++;
      if (done % 4 === 0 || done === urls.length){
        onProgress && onProgress({ done, total: urls.length, errors });
      }
      // Drobno zakasnitev, da ne povozimo strežnika
      await new Promise(r => setTimeout(r, 30));
    }
  }

  const workers = Array(concurrency).fill(0).map(() => worker());
  try {
    await Promise.all(workers);
  } catch (e){
    /* ignored */
  }
  onProgress && onProgress({ done, total: urls.length, errors, finished: true });
  return { done, total: urls.length, errors };
}

// Ocena velikosti za bbox
export function estimateTileCount(parcels, zoomMin = 14, zoomMax = 18, providers = ['osm', 'sat']){
  return tilesForParcels(parcels, zoomMin, zoomMax, providers).length;
}

// Velikost cache-a tile-ov v MB (oceniti od števila vnosov × ~15 KB)
export async function tileCacheStats(){
  try {
    const cache = await caches.open('agrotracker-tiles-v1');
    const keys = await cache.keys();
    return { count: keys.length, approxMB: (keys.length * 15) / 1024 };
  } catch {
    return { count: 0, approxMB: 0 };
  }
}

// Počisti tile cache
export async function clearTileCache(){
  try {
    await caches.delete('agrotracker-tiles-v1');
    return true;
  } catch {
    return false;
  }
}
