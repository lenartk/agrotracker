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
          { id: 'prevcov-fill', type: 'fill', source: 'prevcov',
            paint: { 'fill-color': '#22c55e', 'fill-opacity': 0.14 } },
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
            paint: { 'line-color': '#f59e0b', 'line-width': 4, 'line-opacity': 0.95 } }
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
    this._covFeatures = [];    // [{type:'Feature',geometry:{LineString},properties:{w0}}]
    this._runLastEnd = null;

    this.follow = true;

    this.map.on('click', 'parcels-fill', (e) => {
      const f = e.features && e.features[0];
      if (f && this.onParcelClick) this.onParcelClick(f.properties.id);
    });
  }

  _run(fn){ if (this._ready) fn(); else this._q.push(fn); }

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
    this._run(() => {
      this.map.setPaintProperty('cov-line', 'line-color', color);
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

  // Zvezno risanje pokritosti (marker poteza) — en LineString na neprekinjen niz
  paintSegment(fromLL, toLL, widthM){
    const last = this._runLastEnd;
    const cont = last &&
      Math.abs(last.lat - fromLL.lat) * 111320 < 0.5 &&
      Math.abs(last.lng - fromLL.lng) * 111320 < 0.5;
    const w0 = w0For(widthM, fromLL.lat);
    const active = this._covFeatures.length ? this._covFeatures[this._covFeatures.length - 1] : null;

    if (cont && active && Math.abs(active.properties.w0 - w0) / w0 < 0.02){
      active.geometry.coordinates.push([toLL.lng, toLL.lat]);
    } else {
      this._covFeatures.push({
        type: 'Feature',
        properties: { w0 },
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

  clearCoverage(){
    this._covFeatures = [];
    this._runLastEnd = null;
    this._run(() => this.map.getSource('cov').setData(FC()));
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
