// Abstrakcija za GPS. Trije viri:
//   'phone' — Geolocation API na telefonu
//   'ble'   — ESP32 pošilja fix preko BLE (msg.t === 'gps')
//   'sim'   — ročna simulacija (dotik na karti določi cilj, vozilo lovi)
//
// Vedno oddamo standardni Fix: { lat, lng, spdKmh, headingDeg, accuracyM, tsMs, source }

import { ble } from './ble.js';
import { DEFAULTS } from './constants.js';
import { haversine, bearing } from './geo.js';

class GPSSource extends EventTarget {
  constructor(){
    super();
    this.source = 'phone';     // 'phone' | 'ble' | 'sim'
    this.lastFix = null;
    this._watchId = null;
    this._simTarget = null;    // {lat,lng}
    this._simSpeed = DEFAULTS.simSpeedKmh;
    this._simPos = null;
    this._simRafId = null;
    this._simLastTs = 0;

    // BLE message listener
    ble.addEventListener('msg:gps', (e) => {
      if (this.source !== 'ble') return;
      const m = e.detail;
      if (typeof m.lat !== 'number' || typeof m.lng !== 'number') return;
      const fix = {
        lat: m.lat, lng: m.lng,
        spdKmh: m.spd ?? this._estSpeed({lat:m.lat,lng:m.lng}),
        headingDeg: m.hdg ?? null,
        accuracyM: m.hdop ? m.hdop * 2.5 : null,
        satellites: m.sats ?? null,
        fixType: m.fix ?? null,
        tsMs: Date.now(),
        source: 'ble'
      };
      this._emitFix(fix);
    });

    ble.addEventListener('disconnect', () => {
      if (this.source === 'ble'){
        this.dispatchEvent(new CustomEvent('source-lost', { detail: { source: 'ble' } }));
      }
    });
  }

  setSource(src){
    if (!['phone','ble','sim'].includes(src)) return;
    if (src === this.source) return;
    this._stopPhone();
    this._stopSim();
    this.source = src;
    this.dispatchEvent(new CustomEvent('source-changed', { detail: { source: src } }));
    if (src === 'phone') this._startPhone();
    if (src === 'sim')   this._startSim();
    // ble se zažene avtomatsko, ko stroj pošlje podatke
  }

  setSimTarget(latlng){
    this._simTarget = latlng;
    if (!this._simPos && this.source === 'sim'){
      // Če še nimamo pozicije, skoči na prvi klik
      this._simPos = { ...latlng };
      this._emitFix({
        lat: latlng.lat, lng: latlng.lng, spdKmh: 0, headingDeg: null,
        accuracyM: 1.0, tsMs: Date.now(), source: 'sim'
      });
    }
  }

  setSimSpeed(kmh){ this._simSpeed = Math.max(0, kmh); }
  setSimPosition(latlng){ this._simPos = latlng ? { ...latlng } : null; }

  // ---- PHONE ----
  _startPhone(){
    if (!navigator.geolocation){
      this.dispatchEvent(new CustomEvent('error', { detail: { reason: 'no-geo' } }));
      return;
    }
    this._watchId = navigator.geolocation.watchPosition(
      (pos) => {
        const c = pos.coords;
        const fix = {
          lat: c.latitude, lng: c.longitude,
          spdKmh: (c.speed != null ? c.speed * 3.6 : this._estSpeed({lat:c.latitude,lng:c.longitude})),
          headingDeg: (c.heading != null && !isNaN(c.heading)) ? c.heading : null,
          accuracyM: c.accuracy || null,
          altitudeM: c.altitude || null,
          tsMs: pos.timestamp || Date.now(),
          source: 'phone'
        };
        this._emitFix(fix);
      },
      (err) => {
        this.dispatchEvent(new CustomEvent('error', { detail: { reason: 'geo-err', code: err.code, message: err.message } }));
      },
      { enableHighAccuracy: true, maximumAge: 0, timeout: 15000 }
    );
  }

  _stopPhone(){
    if (this._watchId != null){
      navigator.geolocation.clearWatch(this._watchId);
      this._watchId = null;
    }
  }

  // ---- SIM ----
  _startSim(){
    this._simLastTs = 0;
    const loop = (ts) => {
      if (this.source !== 'sim') return;
      if (!this._simLastTs) this._simLastTs = ts;
      const dt = Math.max(0.016, (ts - this._simLastTs) / 1000);
      this._simLastTs = ts;
      if (this._simPos && this._simTarget){
        const dx = (this._simTarget.lng - this._simPos.lng);
        const dy = (this._simTarget.lat - this._simPos.lat);
        const distM = haversine(this._simPos, this._simTarget);
        const stepM = (this._simSpeed / 3.6) * dt;
        let emitted = false;
        if (distM <= stepM){
          this._simPos = { ...this._simTarget };
          const fix = {
            lat: this._simPos.lat, lng: this._simPos.lng, spdKmh: 0,
            headingDeg: null, accuracyM: 1.0, tsMs: Date.now(), source: 'sim'
          };
          this._emitFix(fix);
          this._simTarget = null;
          emitted = true;
        } else {
          const f = stepM / distM;
          const next = { lat: this._simPos.lat + dy * f, lng: this._simPos.lng + dx * f };
          const hdg = bearing(this._simPos, next);
          this._simPos = next;
          const fix = {
            lat: next.lat, lng: next.lng, spdKmh: this._simSpeed,
            headingDeg: hdg, accuracyM: 1.0, tsMs: Date.now(), source: 'sim'
          };
          this._emitFix(fix);
          emitted = true;
        }
      }
      this._simRafId = requestAnimationFrame(loop);
    };
    this._simRafId = requestAnimationFrame(loop);
  }

  _stopSim(){
    if (this._simRafId != null){
      cancelAnimationFrame(this._simRafId);
      this._simRafId = null;
    }
  }

  // Oceni hitrost iz zadnjih dveh fixov (če je ni dobavljena)
  _estSpeed(latlng){
    if (!this.lastFix) return 0;
    const dt = (Date.now() - this.lastFix.tsMs) / 1000;
    if (dt <= 0.05 || dt > 10) return 0;
    const d = haversine(this.lastFix, latlng);
    return (d / dt) * 3.6;
  }

  _emitFix(fix){
    // Heading fallback iz dveh fixov
    if (fix.headingDeg == null && this.lastFix){
      const d = haversine(this.lastFix, fix);
      if (d > 0.8) fix.headingDeg = bearing(this.lastFix, fix);
      else fix.headingDeg = this.lastFix.headingDeg;
    }
    this.lastFix = fix;
    this.dispatchEvent(new CustomEvent('fix', { detail: fix }));
  }

  status(){
    return {
      source: this.source,
      lastFix: this.lastFix,
      ageMs: this.lastFix ? (Date.now() - this.lastFix.tsMs) : null
    };
  }
}

export const gps = new GPSSource();
