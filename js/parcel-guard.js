// Varnostni sloj za parcele in Leaflet.
// Namen: slab GeoJSON (napačen koordinatni sistem, zamenjan lat/lng, prevelik bbox)
// ne sme več vreči karte v črnino ali neuporaben pogled.
(function(){
  'use strict';

  const DB_NAME = 'agrotracker';
  const DB_VERSION = 1;
  const SLO_LNG = [13.0, 17.2];
  const SLO_LAT = [45.0, 47.3];
  const MAX_REASONABLE_SPAN_DEG = 8;

  function finiteNumber(v){
    return typeof v === 'number' && Number.isFinite(v);
  }

  function escapeHtml(s){
    return String(s).replace(/[&<>"']/g, c => ({
      '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'
    }[c]));
  }

  function isLngLatPair(pair){
    return Array.isArray(pair) && pair.length >= 2 && finiteNumber(pair[0]) && finiteNumber(pair[1]);
  }

  function inRange(v, min, max){
    return finiteNumber(v) && v >= min && v <= max;
  }

  function insideSloveniaLike(lng, lat){
    return inRange(lng, SLO_LNG[0], SLO_LNG[1]) && inRange(lat, SLO_LAT[0], SLO_LAT[1]);
  }

  function walkCoordPairs(coords, cb){
    if (!Array.isArray(coords)) return;
    if (isLngLatPair(coords)){
      cb(coords);
      return;
    }
    for (const child of coords) walkCoordPairs(child, cb);
  }

  function featureStats(feature){
    const stats = {
      total: 0,
      finitePairs: 0,
      validWorld: 0,
      sloveniaLike: 0,
      swappedSloveniaLike: 0,
      projectedLike: 0,
      minLng: Infinity,
      minLat: Infinity,
      maxLng: -Infinity,
      maxLat: -Infinity,
    };
    const g = feature && feature.geometry;
    if (!g || !g.coordinates) return stats;

    walkCoordPairs(g.coordinates, pair => {
      stats.total++;
      const lng = pair[0];
      const lat = pair[1];
      if (!finiteNumber(lng) || !finiteNumber(lat)) return;
      stats.finitePairs++;

      if (Math.abs(lng) > 180 || Math.abs(lat) > 90){
        stats.projectedLike++;
        return;
      }

      stats.validWorld++;
      if (insideSloveniaLike(lng, lat)) stats.sloveniaLike++;
      if (insideSloveniaLike(lat, lng)) stats.swappedSloveniaLike++;
      stats.minLng = Math.min(stats.minLng, lng);
      stats.maxLng = Math.max(stats.maxLng, lng);
      stats.minLat = Math.min(stats.minLat, lat);
      stats.maxLat = Math.max(stats.maxLat, lat);
    });

    return stats;
  }

  function summarizeStats(stats){
    if (!stats.total) return { level: 'bad', text: 'Ni koordinat.' };
    if (stats.projectedLike > 0){
      return {
        level: 'bad',
        text: 'Koordinate so videti kot projekcijski sistem, ne WGS84. Pretvori v EPSG:4326.'
      };
    }
    if (stats.validWorld === 0){
      return { level: 'bad', text: 'Ni veljavnih WGS84 koordinat.' };
    }
    if (stats.swappedSloveniaLike > stats.sloveniaLike && stats.swappedSloveniaLike > stats.total * 0.5){
      return {
        level: 'bad',
        text: 'Koordinate so verjetno obrnjene. GeoJSON mora biti [lng, lat], ne [lat, lng].'
      };
    }
    const spanLng = stats.maxLng - stats.minLng;
    const spanLat = stats.maxLat - stats.minLat;
    if (spanLng > MAX_REASONABLE_SPAN_DEG || spanLat > MAX_REASONABLE_SPAN_DEG){
      return { level: 'warn', text: 'BBox je zelo velik. Preveri, ali si uvozil samo svoje parcele.' };
    }
    if (stats.sloveniaLike === 0){
      return { level: 'warn', text: 'Koordinate so WGS84, niso pa videti v Sloveniji.' };
    }
    return { level: 'ok', text: 'Koordinate so videti pravilne za Slovenijo.' };
  }

  function boundsLooksUsable(bounds){
    if (!bounds || typeof bounds.isValid !== 'function' || !bounds.isValid()) return false;
    const sw = bounds.getSouthWest();
    const ne = bounds.getNorthEast();
    const vals = [sw.lat, sw.lng, ne.lat, ne.lng];
    if (!vals.every(finiteNumber)) return false;
    if (Math.abs(sw.lat) > 90 || Math.abs(ne.lat) > 90) return false;
    if (Math.abs(sw.lng) > 180 || Math.abs(ne.lng) > 180) return false;
    if (Math.abs(ne.lat - sw.lat) > MAX_REASONABLE_SPAN_DEG) return false;
    if (Math.abs(ne.lng - sw.lng) > MAX_REASONABLE_SPAN_DEG) return false;
    return true;
  }

  function notify(msg){
    console.warn('[AgroTracker parcel guard]', msg);
    const toast = document.getElementById('toast');
    if (!toast) return;
    toast.textContent = msg;
    toast.classList.add('show');
    window.clearTimeout(window.__agroParcelGuardToastTimer);
    window.__agroParcelGuardToastTimer = window.setTimeout(() => toast.classList.remove('show'), 4200);
  }

  function patchLeafletFitBounds(){
    if (!window.L || !L.Map || L.Map.prototype.__agroParcelGuardPatched) return;
    const originalFitBounds = L.Map.prototype.fitBounds;
    L.Map.prototype.fitBounds = function(bounds, options){
      let b;
      try {
        b = L.latLngBounds(bounds);
      } catch (e){
        notify('Karte ne morem približati: neveljaven bbox parcele.');
        return this;
      }
      if (!boundsLooksUsable(b)){
        notify('Parcela ima sumljive koordinate. Preveri GeoJSON/EPSG:4326.');
        return this;
      }
      return originalFitBounds.call(this, b, options);
    };
    L.Map.prototype.__agroParcelGuardPatched = true;
  }

  function openDB(){
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async function loadParcelsFromDB(){
    const db = await openDB();
    try {
      return await new Promise((resolve, reject) => {
        const tx = db.transaction('parcels', 'readonly');
        const store = tx.objectStore('parcels');
        const req = store.getAll();
        req.onsuccess = () => resolve(req.result || []);
        req.onerror = () => reject(req.error);
      });
    } finally {
      db.close();
    }
  }

  async function runParcelDiagnostics(){
    const out = document.getElementById('parcelDiagOutput');
    if (!out) return;
    out.textContent = 'Preverjam…';
    try {
      const parcels = await loadParcelsFromDB();
      if (!parcels.length){
        out.innerHTML = '<div class="note">Ni shranjenih parcel. Najprej uvozi GeoJSON.</div>';
        return;
      }
      const rows = parcels.slice(0, 30).map((p, idx) => {
        const stats = featureStats(p.feature);
        const s = summarizeStats(stats);
        const bbox = stats.validWorld ?
          `${stats.minLng.toFixed(5)}, ${stats.minLat.toFixed(5)} → ${stats.maxLng.toFixed(5)}, ${stats.maxLat.toFixed(5)}` :
          '—';
        const icon = s.level === 'ok' ? '✅' : (s.level === 'warn' ? '⚠️' : '❌');
        return `
          <div class="diag-row ${s.level}">
            <strong>${icon} ${idx + 1}. ${escapeHtml(p.name || p.id || 'Parcela')}</strong><br>
            <span class="small muted">${escapeHtml(p.feature?.geometry?.type || 'brez geometrije')} • ${stats.total} točk • ${bbox}</span><br>
            <span class="small">${escapeHtml(s.text)}</span>
          </div>`;
      }).join('');
      const extra = parcels.length > 30 ? `<div class="note">Prikazanih je prvih 30 od ${parcels.length} parcel.</div>` : '';
      out.innerHTML = rows + extra;
    } catch (e){
      console.error(e);
      out.innerHTML = '<div class="note" style="color:var(--bad)">Diagnostika ni uspela. Odpri konzolo za podrobnosti.</div>';
    }
  }

  async function clearAppCacheAndReload(){
    try {
      if ('serviceWorker' in navigator){
        const regs = await navigator.serviceWorker.getRegistrations();
        await Promise.all(regs.map(r => r.unregister()));
      }
      if ('caches' in window){
        const keys = await caches.keys();
        await Promise.all(keys.filter(k => k.startsWith('agrotracker-')).map(k => caches.delete(k)));
      }
    } catch (e){
      console.warn('Cache reset ni uspel v celoti', e);
    }
    location.reload();
  }

  function wireDiagnosticsUI(){
    const diagBtn = document.getElementById('settingsParcelDiagBtn');
    if (diagBtn && !diagBtn.__wired){
      diagBtn.__wired = true;
      diagBtn.addEventListener('click', runParcelDiagnostics);
    }
    const cacheBtn = document.getElementById('settingsHardReloadBtn');
    if (cacheBtn && !cacheBtn.__wired){
      cacheBtn.__wired = true;
      cacheBtn.addEventListener('click', clearAppCacheAndReload);
    }
  }

  patchLeafletFitBounds();
  document.addEventListener('DOMContentLoaded', wireDiagnosticsUI);
  window.addEventListener('load', wireDiagnosticsUI);

  window.agroParcelGuard = {
    featureStats,
    summarizeStats,
    runParcelDiagnostics,
    clearAppCacheAndReload,
    boundsLooksUsable,
  };
})();
