// Ovijalnik za MapLibre GL. Upravlja plasti (satelit/OSM), parcele, vozilo,
// pokritost, AB vodenje in 2D/3D preklop (teren iz terrarium DEM).
//
// Zakaj MapLibre namesto Leafleta (fiksna odločitev spremenjena 2026-07-16 na
// zahtevo uporabnika): potreben je pravi 3D pogled s terenom za hribovske
// parcele — Leaflet tega ne zmore. En motor pokriva obe opciji (2D = pitch 0).
//
// Javni API je ohranjen iz Leaflet verzije, da app.js skoraj ni bilo treba
// spreminjati. Vse geometrije so GeoJSON viri + sloji.

const EARTH_C = 40075016.686;

// Metrična širina črte: w0 = širina v px pri zoom 0, MapLibre eksponentna
// interpolacija (baza 2) potem točno sledi metrom na vseh zoomih.
function w0For(widthM, lat){
  return widthM * 512 / (EARTH_C * Math.cos(lat * Math.PI / 180));
}
const METRIC_WIDTH = (prop) => ([
  'interpolate', ['exponential', 2], ['zoom'],
  0, ['get', prop],
  24, ['*', ['get', prop], 16777216] // 2^24
]);

const FC = (features = []) => ({ type: 'FeatureCollection', features });

export class MapController {
  constructor(el, opts = {}){
    const center = opts.center || [46.0515, 14.503];
    this.map = new maplibregl.Map({
      container: el,
      center: [center[1], center[0]],   // maplibre je [lng,lat]
      zoom: opts.zoom || 16,
      attributionControl: false,
      pitchWithRotate: true,
      maxPitch: 70,
      preserveDrawingBuffer: true, // omogoči screenshote karte (tudi testne)
      fadeDuration: 0,             // brez bledenja tile-ov — hitrejši vtis
      style: {
        version: 8,
        sources: {
          sat: {
            type: 'raster', tileSize: 256, maxzoom: 19,
            tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}']
          },
          osm: {
            type: 'raster', tileSize: 256, maxzoom: 19,
            tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png']
          },
          dem: {
            type: 'raster-dem', tileSize: 256, maxzoom: 15, encoding: 'terrarium',
            tiles: ['https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png']
          },
          parcels: { type: 'geojson', data: FC() },
          prevcov: { type: 'geojson', data: FC() },
          drive:   { type: 'geojson', data: FC() },
          impl:    { type: 'geojson', data: FC() },
          overlay: { type: 'geojson', data: FC() },
          sel:     { type: 'geojson', data: FC() },
          cov:     { type: 'geojson', data: FC() },
          guide:   { type: 'geojson', data: FC() }
        },
        layers: [
          { id: 'bg', type: 'background', paint: { 'background-color': '#060807' } },
          { id: 'sat', type: 'raster', source: 'sat' },
          { id: 'osm', type: 'raster', source: 'osm', layout: { visibility: 'none' } },
          { id: 'hillshade', type: 'hillshade', source: 'dem',
            layout: { visibility: 'none' },
            paint: { 'hillshade-exaggeration': 0.35 } },
          { id: 'overlay-fill', type: 'fill', source: 'overlay',
            paint: { 'fill-color': ['coalesce', ['get', '_c'], '#888888'], 'fill-opacity': 0.35 } },
          { id: 'overlay-line', type: 'line', source: 'overlay',
            paint: { 'line-color': ['coalesce', ['get', '_c'], '#888888'], 'line-width': 1, 'line-opacity': 0.8 } },
          { id: 'prevcov-fill', type: 'fill', source: 'prevcov',
            paint: { 'fill-color': '#22c55e', 'fill-opacity': 0.14 } },
          { id: 'drive-line', type: 'line', source: 'drive',
            layout: { 'line-cap': 'round', 'line-join': 'round' },
            paint: { 'line-color': '#ffffff', 'line-width': 1.6, 'line-opacity': 0.55 } },
          { id: 'cov-line', type: 'line', source: 'cov',
            layout: { 'line-cap': 'butt', 'line-join': 'round' },
            paint: { 'line-color': '#22c55e', 'line-opacity': 0.38,
                     'line-width': METRIC_WIDTH('w0') } },
          { id: 'parcels-fill', type: 'fill', source: 'parcels',
            paint: { 'fill-color': '#4ade80', 'fill-opacity': 0.08 } },
          { id: 'parcels-line', type: 'line', source: 'parcels',
            paint: { 'line-color': '#86efac', 'line-width': 2, 'line-dasharray': [3, 2.5] } },
          { id: 'parcels-sel', type: 'line', source: 'parcels',
            filter: ['==', ['get', 'id'], '___none___'],
            paint: { 'line-color': '#22c55e', 'line-width': 3 } },
          { id: 'guide-line', type: 'line', source: 'guide',
            filter: ['==', ['get', 'active'], 0],
            paint: { 'line-color': '#ffffff', 'line-width': 1.5,
                     'line-opacity': 0.45, 'line-dasharray': [4, 5] } },
          { id: 'guide-active', type: 'line', source: 'guide',
            filter: ['==', ['get', 'active'], 1],
            paint: { 'line-color': '#f59e0b', 'line-width': 4, 'line-opacity': 0.95 } },
          { id: 'impl-line', type: 'line', source: 'impl',
            paint: { 'line-color': '#facc15', 'line-width': 2, 'line-opacity': 0.9 } },
          { id: 'sel-fill', type: 'fill', source: 'sel',
            paint: { 'fill-color': '#38bdf8', 'fill-opacity': 0.18 } },
          { id: 'sel-line', type: 'line', source: 'sel',
            paint: { 'line-color': '#38bdf8', 'line-width': 2.5, 'line-dasharray': [3, 2] } }
        ]
      }
    });

    // Style se nalaga asinhrono — operacije nad sloji/viri do 'load' čakajo v vrsti
    this._ready = false;
    this._q = [];
    this.map.on('load', () => {
      this._ready = true;
      this._q.forEach(fn => fn());
      this._q = [];
    });

    this.satOn = true;
    this.is3D = false;
    this.parcelFeatures = [];
    this.selectedParcelId = null;
    this.onParcelClick = null;
    this.vehicleMarker = null;
    this._abMarkers = {};

    this.paintColor = '#22c55e';
    this.paintOpacity = 0.38;
    this._covFeatures = [];    // [{type:'Feature',geometry:{LineString},properties:{w0,i}}]
    this._runLastEnd = null;
    this._driveFeatures = [];  // tanka črta celotne poti (tudi brez dela)
    this._driveLastEnd = null;

    this.follow = true;

    this.map.on('click', 'parcels-fill', (e) => {
      const f = e.features && e.features[0];
      if (f && this.onParcelClick) this.onParcelClick(f.properties.id);
    });

    // Google Maps vedenje: ročni premik karte izklopi sledenje vozilu.
    // Nazaj ga vklopi tipka (križec) — glej app.js onFollowChange.
    this.onFollowChange = null;
    this.map.on('dragstart', () => this.setFollow(false));
    this.map.on('rotatestart', () => this.setFollow(false));
  }

  _run(fn){ if (this._ready) fn(); else this._q.push(fn); }

  setFollow(on){
    if (this.follow === on) return;
    this.follow = on;
    if (this.onFollowChange) this.onFollowChange(on);
  }

  resize(){ this.map.resize(); }

  toggleSatellite(){
    this.satOn = !this.satOn;
    this._run(() => {
    this.map.setLayoutProperty('sat', 'visibility', this.satOn ? 'visible' : 'none');
    this.map.setLayoutProperty('osm', 'visibility', this.satOn ? 'none' : 'visible');
    });
    return this.satOn;
  }

  // 2D top-down <-> pravi 3D s terenom
  setMode3D(on){
    this.is3D = on;
    this._run(() => {
    if (on){
      this.map.setTerrain({ source: 'dem', exaggeration: 1.15 });
      this.map.setLayoutProperty('hillshade', 'visibility', 'visible');
      this.map.easeTo({ pitch: 58, duration: 600 });
    } else {
      this.map.easeTo({ pitch: 0, bearing: 0, duration: 400 });
      this.map.setLayoutProperty('hillshade', 'visibility', 'none');
      setTimeout(() => { if (!this.is3D) this.map.setTerrain(null); }, 450);
    }
    });
    return this.is3D;
  }

  setPaintStyle(color, opacity){
    this.paintColor = color;
    this.paintOpacity = opacity;
    const mix = (hex, target, f) => {
      const h = hex.replace('#',''); const t = target.replace('#','');
      const c = (i) => Math.round(parseInt(h.substr(i,2),16)*(1-f) + parseInt(t.substr(i,2),16)*f)
        .toString(16).padStart(2,'0');
      return '#' + c(0) + c(2) + c(4);
    };
    // heatmap intenzivnosti: i = dejanski odmerek / nastavljeni (1 = točno)
    const ramp = ['interpolate', ['linear'], ['coalesce', ['get','i'], 1],
      0.5, mix(color, '#ffffff', 0.55),
      1.0, color,
      1.6, mix(color, '#000000', 0.45)];
    this._run(() => {
      this.map.setPaintProperty('cov-line', 'line-color', ramp);
      this.map.setPaintProperty('cov-line', 'line-opacity', opacity);
      this.map.setPaintProperty('prevcov-fill', 'fill-color', color);
    });
  }

  setParcels(features, selectedId = null){
    // features: [{id, name, feature}] — GeoJSON z lastnostmi za klik
    this.parcelFeatures = features.map(f => ({
      type: 'Feature',
      properties: { id: f.id, name: f.name },
      geometry: f.feature.geometry
    }));
    this._run(() => this.map.getSource('parcels').setData(FC(this.parcelFeatures)));
    this._parcelRefs = features;
    if (selectedId) this.highlightParcel(selectedId);
  }

  highlightParcel(id){
    this.selectedParcelId = id;
    this._run(() => this.map.setFilter('parcels-sel', ['==', ['get', 'id'], id ?? '___none___']));
  }

  _boundsOf(feature){
    // [minLng,minLat,maxLng,maxLat] čez vse koordinate
    let mnLa = Infinity, mnLo = Infinity, mxLa = -Infinity, mxLo = -Infinity;
    const walk = (c) => {
      if (typeof c[0] === 'number'){
        if (c[1] < mnLa) mnLa = c[1];
        if (c[1] > mxLa) mxLa = c[1];
        if (c[0] < mnLo) mnLo = c[0];
        if (c[0] > mxLo) mxLo = c[0];
      } else c.forEach(walk);
    };
    walk(feature.geometry.coordinates);
    return [[mnLo, mnLa], [mxLo, mxLa]];
  }

  fitToParcel(id){
    const p = (this._parcelRefs || []).find(x => x.id === id);
    if (!p) return;
    this.map.fitBounds(this._boundsOf(p.feature), { padding: 60, duration: 400 });
  }

  fitToAllParcels(){
    if (!this._parcelRefs || !this._parcelRefs.length) return;
    let b = null;
    this._parcelRefs.forEach(p => {
      const [[a, c], [d, e]] = this._boundsOf(p.feature);
      if (!b) b = [[a, c], [d, e]];
      else b = [[Math.min(b[0][0], a), Math.min(b[0][1], c)], [Math.max(b[1][0], d), Math.max(b[1][1], e)]];
    });
    if (b) this.map.fitBounds(b, { padding: 60, duration: 400 });
  }

  ensureVehicle(latlng){
    if (!this.vehicleMarker){
      const el = document.createElement('div');
      el.className = 'vehicle-marker';
      el.id = 'vehMarker';
      el.innerHTML = '<div class="ring"></div><div class="arrow"></div>';
      this.vehicleMarker = new maplibregl.Marker({
        element: el, rotationAlignment: 'map', pitchAlignment: 'map'
      }).setLngLat([latlng[1], latlng[0]]).addTo(this.map);
    } else {
      this.vehicleMarker.setLngLat([latlng[1], latlng[0]]);
    }
  }

  setVehicleLatLng(latlng){ this.ensureVehicle(latlng); }

  setVehicleHeading(deg){
    if (deg == null || !this.vehicleMarker) return;
    this.vehicleMarker.setRotation(deg);
  }

  setVehicleActive(isActive){
    const el = document.getElementById('vehMarker');
    if (!el) return;
    el.classList.toggle('inactive', !isActive);
  }

  // Zvezno risanje pokritosti (marker poteza) — en LineString na neprekinjen niz.
  // intensity: flow/set (1 = točen odmerek) ali null — barva heatmap lestvice.
  paintSegment(fromLL, toLL, widthM, intensity = null){
    const last = this._runLastEnd;
    const cont = last &&
      Math.abs(last.lat - fromLL.lat) * 111320 < 0.5 &&
      Math.abs(last.lng - fromLL.lng) * 111320 < 0.5;
    const w0 = w0For(widthM, fromLL.lat);
    const active = this._covFeatures.length ? this._covFeatures[this._covFeatures.length - 1] : null;
    const iVal = intensity == null ? null : Math.max(0.4, Math.min(1.8, intensity));
    const sameI = active && ((active.properties.i == null && iVal == null) ||
      (active.properties.i != null && iVal != null && Math.abs(active.properties.i - iVal) < 0.12));

    if (cont && active && sameI && Math.abs(active.properties.w0 - w0) / w0 < 0.02){
      active.geometry.coordinates.push([toLL.lng, toLL.lat]);
    } else {
      const props = { w0 };
      if (iVal != null) props.i = iVal;
      this._covFeatures.push({
        type: 'Feature',
        properties: props,
        geometry: { type: 'LineString',
          coordinates: [[fromLL.lng, fromLL.lat], [toLL.lng, toLL.lat]] }
      });
    }
    this._runLastEnd = { lat: toLL.lat, lng: toLL.lng };
    this._run(() => this.map.getSource('cov').setData(FC(this._covFeatures)));
    // ponytail: setData celotne zbirke ob vsakem vzorcu; pri >20k točkah na sejo
    // preidi na inkrementalne vire po run-ih

    const dLat = (toLL.lat - fromLL.lat) * 111320;
    const dLng = (toLL.lng - fromLL.lng) * 111320 * Math.cos(fromLL.lat * Math.PI / 180);
    return Math.sqrt(dLat*dLat + dLng*dLng);
  }

  // Stil črte poti (Prevoz: debelejša, v barvi operacije)
  setDriveStyle(widthPx, color){
    this._run(() => {
      this.map.setPaintProperty('drive-line', 'line-width', widthPx);
      this.map.setPaintProperty('drive-line', 'line-color', color);
    });
  }

  // Tanka črta poti — riše se VEDNO med sejo (tudi ko stroj ne dela)
  paintDrive(fromLL, toLL){
    const last = this._driveLastEnd;
    const cont = last &&
      Math.abs(last.lat - fromLL.lat) * 111320 < 0.5 &&
      Math.abs(last.lng - fromLL.lng) * 111320 < 0.5;
    const active = this._driveFeatures.length ? this._driveFeatures[this._driveFeatures.length - 1] : null;
    if (cont && active){
      active.geometry.coordinates.push([toLL.lng, toLL.lat]);
    } else {
      this._driveFeatures.push({
        type: 'Feature', properties: {},
        geometry: { type: 'LineString',
          coordinates: [[fromLL.lng, fromLL.lat], [toLL.lng, toLL.lat]] }
      });
    }
    this._driveLastEnd = { lat: toLL.lat, lng: toLL.lng };
    this._run(() => this.map.getSource('drive').setData(FC(this._driveFeatures)));
  }

  clearCoverage(){
    this._covFeatures = [];
    this._runLastEnd = null;
    this._driveFeatures = [];
    this._driveLastEnd = null;
    this._run(() => {
      this.map.getSource('cov').setData(FC());
      this.map.getSource('drive').setData(FC());
    });
  }

  // Pokritost prejšnjih sej — zbledeli poligoni
  loadPrevCoverage(stripPolygons, color){
    if (!Array.isArray(stripPolygons)) return;
    const feats = stripPolygons.map(poly => ({
      type: 'Feature', properties: {},
      geometry: { type: 'Polygon',
        coordinates: [poly.map(p => [p[1], p[0]]).concat([[poly[0][1], poly[0][0]]])] }
    }));
    this._run(() => {
      this.map.setPaintProperty('prevcov-fill', 'fill-color', color);
      this.map.getSource('prevcov').setData(FC(feats));
    });
  }

  clearPrevCoverage(){ this._run(() => this.map.getSource('prevcov').setData(FC())); }

  // ---- AB guidance ----
  setGuidanceLines(lines, activeIdx){
    const feats = lines.map(l => ({
      type: 'Feature',
      properties: { active: l.idx === activeIdx ? 1 : 0 },
      geometry: { type: 'LineString',
        coordinates: l.pts.map(p => [p[1], p[0]]) }
    }));
    this._run(() => this.map.getSource('guide').setData(FC(feats)));
  }

  setAbMarker(label, latlng){
    if (this._abMarkers[label]) this._abMarkers[label].remove();
    const el = document.createElement('div');
    el.className = 'ab-marker';
    el.textContent = label;
    this._abMarkers[label] = new maplibregl.Marker({ element: el })
      .setLngLat([latlng[1], latlng[0]]).addTo(this.map);
  }

  // Obris priključka: pravokotnik okoli delovnega centra glede na smer
  setImplementRect(center, headingDeg, geo){
    const r = headingDeg * Math.PI / 180;
    const ux = Math.sin(r), uy = Math.cos(r);       // smer vožnje (E,N)
    const nx = -uy, ny = ux;                         // levo
    const kx = 111320 * Math.cos(center.lat * Math.PI / 180);
    const oL = geo.latOff + geo.width / 2, oR = geo.latOff - geo.width / 2;
    const dLen = 0.7;                                // navidezna dolžina orodja
    const pt = (t, o) => [
      center.lng + (t * ux + o * nx) / kx,
      center.lat + (t * uy + o * ny) / 111320
    ];
    const ring = [pt(dLen, oL), pt(dLen, oR), pt(-dLen, oR), pt(-dLen, oL), pt(dLen, oL)];
    this._run(() => this.map.getSource('impl').setData(FC([{
      type: 'Feature', properties: {},
      geometry: { type: 'LineString', coordinates: ring }
    }])));
  }

  // Ročno narisano območje za analizo (točke [[lat,lng], ...])
  setSelection(pts){
    if (!pts || pts.length < 2){
      this._run(() => this.map.getSource('sel').setData(FC()));
      return;
    }
    const ring = pts.map(p => [p[1], p[0]]);
    const feat = pts.length >= 3
      ? { type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [ring.concat([ring[0]])] } }
      : { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: ring } };
    this._run(() => this.map.getSource('sel').setData(FC([feat])));
  }

  setOverlay(features){
    this._run(() => this.map.getSource('overlay').setData(FC(features || [])));
  }

  clearImplementRect(){ this._run(() => this.map.getSource('impl').setData(FC())); }

  clearGuidance(){
    this._run(() => this.map.getSource('guide').setData(FC()));
    Object.values(this._abMarkers).forEach(m => m.remove());
    this._abMarkers = {};
  }

  centerOn(latlng, zoom){
    this.map.easeTo({
      center: [latlng[1], latlng[0]],
      zoom: zoom || Math.max(this.map.getZoom(), 17),
      duration: 350
    });
  }

  // Sledenje vozilu: vozilo držimo na 62 % višine ekrana (offset od centra).
  // jumpTo offset ne upošteva — easeTo z duration 0 ga.
  softFollow(latlng){
    if (!this.follow) return;
    const h = this.map.getContainer().clientHeight;
    this.map.easeTo({
      center: [latlng[1], latlng[0]],
      offset: [0, (0.62 - 0.5) * h], // pozitivno = center prikazan nižje = vozilo na 62 %
      duration: 0
    });
  }

  destroy(){
    if (this.map){ this.map.remove(); this.map = null; }
  }
}
