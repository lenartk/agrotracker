// Ovijalnik za Leaflet map. Upravlja plasti (OSM / satelit), parcele, vozilo, trakove pokritja.

import { createStrip } from './geo.js';

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
      const layer = L.geoJSON(f, {
        style: {
          color: '#86efac', weight: 2, fillColor: '#4ade80',
          fillOpacity: 0.08, dashArray: '6,5', className: 'parcel'
        }
      }).addTo(this.parcelLayer);
      layer.on('click', () => { if (this.onParcelClick) this.onParcelClick(f.id); });
      this.parcelRefs.push({ id: f.id, feat: f, layer });
    });
    if (selectedId) this.highlightParcel(selectedId);
  }

  highlightParcel(id){
    this.selectedParcelId = id;
    this.parcelRefs.forEach(p => {
      const isSel = p.id === id;
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
    if (!p) return;
    const b = p.layer.getBounds();
    if (b.isValid()) this.map.fitBounds(b, { padding: [40, 40] });
  }

  fitToAllParcels(){
    if (!this.parcelRefs.length) return;
    const group = L.featureGroup(this.parcelRefs.map(p => p.layer));
    this.map.fitBounds(group.getBounds(), { padding: [40, 40] });
  }

  ensureVehicle(latlng){
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
    this.map.setView(latlng, zoom || Math.max(this.map.getZoom(), 17));
  }

  softFollow(latlng){
    if (!this.follow) return;
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
