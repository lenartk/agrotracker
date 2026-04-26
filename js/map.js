// Ovijalnik za Leaflet map. Upravlja plasti (OSM / satelit), parcele, vozilo, trakove pokritja.

import './parcel-guard.js';
import { createStrip } from './geo.js';

const MAX_REASONABLE_BOUNDS_SPAN_DEG = 8;

function finiteNumber(v){
  return typeof v === 'number' && Number.isFinite(v);
}

function walkCoordPairs(coords, cb){
  if (!Array.isArray(coords)) return;
  if (coords.length >= 2 && finiteNumber(coords[0]) && finiteNumber(coords[1])){
    cb(coords);
    return;
  }
  coords.forEach(child => walkCoordPairs(child, cb));
}

function featureHasUsableCoordinates(feat){
  const g = feat && feat.geometry;
  if (!g || !Array.isArray(g.coordinates)) return false;

  let total = 0;
  let validWorld = 0;
  let minLng = Infinity, minLat = Infinity, maxLng = -Infinity, maxLat = -Infinity;

  walkCoordPairs(g.coordinates, ([lng, lat]) => {
    total++;
    if (!finiteNumber(lng) || !finiteNumber(lat)) return;
    if (Math.abs(lng) > 180 || Math.abs(lat) > 90) return;
    validWorld++;
    minLng = Math.min(minLng, lng);
    maxLng = Math.max(maxLng, lng);
    minLat = Math.min(minLat, lat);
    maxLat = Math.max(maxLat, lat);
  });

  if (!total || !validWorld) return false;
  if ((maxLng - minLng) > MAX_REASONABLE_BOUNDS_SPAN_DEG) return false;
  if ((maxLat - minLat) > MAX_REASONABLE_BOUNDS_SPAN_DEG) return false;
  return true;
}

function latLngLooksUsable(latlng){
  const ll = Array.isArray(latlng) ? { lat: latlng[0], lng: latlng[1] } : latlng;
  return ll && finiteNumber(ll.lat) && finiteNumber(ll.lng) &&
    Math.abs(ll.lat) <= 90 && Math.abs(ll.lng) <= 180;
}

function boundsLooksUsable(bounds){
  if (!bounds || typeof bounds.isValid !== 'function' || !bounds.isValid()) return false;
  const sw = bounds.getSouthWest();
  const ne = bounds.getNorthEast();
  if (![sw.lat, sw.lng, ne.lat, ne.lng].every(finiteNumber)) return false;
  if (Math.abs(sw.lat) > 90 || Math.abs(ne.lat) > 90) return false;
  if (Math.abs(sw.lng) > 180 || Math.abs(ne.lng) > 180) return false;
  if (Math.abs(ne.lat - sw.lat) > MAX_REASONABLE_BOUNDS_SPAN_DEG) return false;
  if (Math.abs(ne.lng - sw.lng) > MAX_REASONABLE_BOUNDS_SPAN_DEG) return false;
  return true;
}

export class MapController {
  constructor(el, opts = {}){
    this.el = el;
    this.map = L.map(el, { zoomControl: false, attributionControl: false, tap: true })
      .setView(opts.center || [46.0515, 14.503], opts.zoom || 16);

    this.osm = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
      { maxZoom: 20, maxNativeZoom: 19 });
    this.sat = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
      { maxZoom: 20, maxNativeZoom: 19 });
    this.sat.addTo(this.map);      // začnemo na satelitu — bolj koristno kmeti
    this.satOn = true;

    this.parcelLayer = L.layerGroup().addTo(this.map);
    this.coverageLayer = L.layerGroup().addTo(this.map);
    this.trackLayer = L.layerGroup().addTo(this.map);

    this.parcelRefs = []; // [{id, feat, layer}]
    this.selectedParcelId = null;
    this.onParcelClick = null;

    this.vehicleMarker = null;

    // Coverage color (nastavi jo operacija)
    this.paintColor = '#22c55e';
    this.paintOpacity = 0.38;
    this.strips = [];
    this.lines = [];

    this.follow = true;
    this.rotateOnHeading = false; // v2 feature — zaenkrat off
  }

  toggleSatellite(){
    if (this.satOn){
      this.map.removeLayer(this.sat);
      this.osm.addTo(this.map);
      this.satOn = false;
    } else {
      this.map.removeLayer(this.osm);
      this.sat.addTo(this.map);
      this.satOn = true;
    }
    return this.satOn;
  }

  setPaintStyle(color, opacity){
    this.paintColor = color;
    this.paintOpacity = opacity;
  }

  setParcels(features, selectedId = null){
    this.parcelLayer.clearLayers();
    this.parcelRefs = [];
    features.forEach((f) => {
      if (!featureHasUsableCoordinates(f)){
        console.warn('Preskočena parcela z neveljavnimi/sumljivimi koordinatami:', f?.properties?.name || f?.id || f);
        return;
      }

      let layer;
      try {
        layer = L.geoJSON(f, {
          style: {
            color: '#86efac', weight: 2, fillColor: '#4ade80',
            fillOpacity: 0.08, dashArray: '6,5', className: 'parcel'
          }
        }).addTo(this.parcelLayer);
      } catch (e){
        console.warn('Parcele ni bilo mogoče narisati:', f?.properties?.name || f?.id || f, e);
        return;
      }

      layer.on('click', () => { if (this.onParcelClick) this.onParcelClick(f.id); });
      this.parcelRefs.push({ id: f.id, feat: f, layer });
    });
    if (selectedId) this.highlightParcel(selectedId);
  }

  highlightParcel(id){
    this.selectedParcelId = id;
    this.parcelRefs.forEach(p => {
      const isSel = p.id === id;
      if (!p.layer || typeof p.layer.setStyle !== 'function') return;
      p.layer.setStyle({
        color: isSel ? '#22c55e' : '#86efac',
        weight: isSel ? 3 : 2,
        fillOpacity: isSel ? 0.14 : 0.08,
        dashArray: isSel ? null : '6,5'
      });
    });
  }

  fitToParcel(id){
    const p = this.parcelRefs.find(x => x.id === id);
    if (!p) {
      console.warn('fitToParcel: parcela ni narisana ali ima neveljavne koordinate:', id);
      return false;
    }
    const b = p.layer.getBounds();
    if (!boundsLooksUsable(b)){
      console.warn('fitToParcel: sumljiv bbox, fitBounds preskočen:', id, b);
      return false;
    }
    this.map.fitBounds(b, { padding: [40, 40], maxZoom: 18 });
    return true;
  }

  fitToAllParcels(){
    const layers = this.parcelRefs.map(p => p.layer).filter(Boolean);
    if (!layers.length) return false;
    const group = L.featureGroup(layers);
    const b = group.getBounds();
    if (!boundsLooksUsable(b)){
      console.warn('fitToAllParcels: sumljiv skupni bbox, fitBounds preskočen:', b);
      return false;
    }
    this.map.fitBounds(b, { padding: [40, 40], maxZoom: 18 });
    return true;
  }

  ensureVehicle(latlng){
    if (!latLngLooksUsable(latlng)) return;
    if (!this.vehicleMarker){
      const icon = L.divIcon({
        className: '', iconSize: [60,60], iconAnchor: [30,30],
        html: '<div class="vehicle-marker" id="vehMarker"><div class="ring"></div><div class="arrow"></div></div>'
      });
      this.vehicleMarker = L.marker(latlng, { icon, zIndexOffset: 1000 }).addTo(this.map);
    } else {
      this.vehicleMarker.setLatLng(latlng);
    }
  }

  setVehicleLatLng(latlng){
    if (!latLngLooksUsable(latlng)) return;
    if (!this.vehicleMarker) this.ensureVehicle(latlng);
    else this.vehicleMarker.setLatLng(latlng);
  }

  setVehicleHeading(deg){
    if (deg == null) return;
    const el = document.querySelector('#vehMarker .arrow');
    if (el) el.style.transform = `translate(-50%,-50%) rotate(${deg}deg)`;
  }

  setVehicleActive(isActive){
    const el = document.getElementById('vehMarker');
    if (!el) return;
    if (isActive) el.classList.remove('inactive'); else el.classList.add('inactive');
  }

  paintSegment(fromLL, toLL, widthM){
    if (!latLngLooksUsable(fromLL) || !latLngLooksUsable(toLL)) return 0;
    const coords = createStrip(fromLL, toLL, widthM);
    if (!coords) return 0;
    const strip = L.polygon(coords, {
      color: 'transparent',
      fillColor: this.paintColor,
      fillOpacity: this.paintOpacity,
      stroke: false
    }).addTo(this.coverageLayer);
    this.strips.push(strip);
    const line = L.polyline([fromLL, toLL], {
      color: this.paintColor, weight: 1.5, opacity: 0.45
    }).addTo(this.trackLayer);
    this.lines.push(line);
    // Vrni dolžino segmenta v m
    const dLat = (toLL.lat - fromLL.lat) * 111320;
    const dLng = (toLL.lng - fromLL.lng) * 111320 * Math.cos(fromLL.lat * Math.PI / 180);
    return Math.sqrt(dLat*dLat + dLng*dLng);
  }

  clearCoverage(){
    this.coverageLayer.clearLayers();
    this.trackLayer.clearLayers();
    this.strips = [];
    this.lines = [];
  }

  // Naloži obstoječe trakove (npr. iz shranjene seje) kot GeoJSON
  loadStrips(stripPolygons){
    if (!Array.isArray(stripPolygons)) return;
    stripPolygons.forEach(poly => {
      // poly: [[lat,lng], ...]
      L.polygon(poly, {
        color: 'transparent', fillColor: this.paintColor,
        fillOpacity: this.paintOpacity, stroke: false
      }).addTo(this.coverageLayer);
    });
  }

  centerOn(latlng, zoom){
    if (!latLngLooksUsable(latlng)) return false;
    this.map.setView(latlng, zoom || Math.max(this.map.getZoom(), 17));
    return true;
  }

  softFollow(latlng){
    if (!this.follow || !latLngLooksUsable(latlng)) return;
    const size = this.map.getSize();
    const p = this.map.latLngToContainerPoint(latlng);
    const target = L.point(size.x / 2, size.y * 0.62);
    const offset = target.subtract(p);
    if (Math.abs(offset.x) > 2 || Math.abs(offset.y) > 2){
      this.map.panBy(offset, { animate: false });
    }
  }

  destroy(){
    if (this.map){
      this.map.remove();
      this.map = null;
    }
  }
}
