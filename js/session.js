// Upravljanje seje dela (opravilo na parceli).
// Seja zbira:
//   - track: [{lat,lng,t,spd,hdg,active,flow}]
//   - strips: [[[lat,lng], ...], ...]   (optimizirano: zapišemo trakove šele ob save)
//   - totals: coveredHa, distanceM, durationMs, flowTotal
//
// Stanja: 'idle' -> 'running' -> 'paused' -> 'running' -> 'stopped'/'saved'

import { DEFAULTS } from './constants.js';
import { haversine, createStrip } from './geo.js';
import { saveSession, newId } from './storage.js';

export class Session {
  constructor({ operation, machine, parcel, note }){
    this.id = newId('ses');
    this.operation = operation;   // OPERATIONS[...] object
    this.machine = machine;       // MACHINES[...] object
    this.parcel = parcel;         // {id, name, ha, feature} or null
    this.note = note || '';

    this.state = 'idle';
    this.startedAt = null;
    this.endedAt = null;
    this.lastResumeAt = null;
    this.activeMsAccum = 0;       // čas, ko smo bili v running
    this.pausedMsAccum = 0;

    this.track = [];              // seznam GPS točk
    this.strips = [];              // seznam poligonov (lat-lng vogali)
    this.abLine = null;           // {a:{lat,lng}, b:{lat,lng}} — AB vodilna linija, če je bila nastavljena
    this.coveredHa = 0;
    this.distanceM = 0;
    this.activeDistanceM = 0;     // razdalja, ko je stroj aktiven (requiresActive)
    this.flowTotal = null;        // opcijski seštevek pretoka
    this.passes = 0;

    this._lastPaintPos = null;
    this._lastPaintAt = 0;
    this._lastSavedAt = 0;
  }

  start(){
    if (this.state === 'idle'){
      this.startedAt = Date.now();
    }
    this.lastResumeAt = Date.now();
    this.state = 'running';
  }

  pause(){
    if (this.state !== 'running') return;
    this.activeMsAccum += Date.now() - (this.lastResumeAt || Date.now());
    this.lastResumeAt = null;
    this.state = 'paused';
  }

  stop(){
    if (this.state === 'running'){
      this.activeMsAccum += Date.now() - (this.lastResumeAt || Date.now());
    }
    this.state = 'stopped';
    this.endedAt = Date.now();
  }

  isActive(){ return this.state === 'running'; }

  // Ali naj barvamo? Odvisno od operacije (requiresActive) in telemetrije iz stroja.
  shouldPaint(machineActive){
    if (this.state !== 'running') return false;
    if (this.operation.requiresActive){
      return !!machineActive;
    }
    return true;
  }

  // Dodaj GPS fix. Vrne info za karto (ali naj se nariše segment).
  // fix: {lat, lng, spdKmh, headingDeg, tsMs, source}
  // machineActive: boolean (iz BLE ali privzeto true)
  // widthM: trenutna širina (lahko prihaja iz BLE-ja)
  // flow: opcijsko (trenutni pretok)
  addFix(fix, machineActive, widthM, flow){
    const now = fix.tsMs || Date.now();
    const point = {
      t: now, lat: fix.lat, lng: fix.lng,
      spd: fix.spdKmh || 0, hdg: fix.headingDeg ?? null,
      active: machineActive ? 1 : 0, src: fix.source || null,
      flow: flow ?? null, w: widthM
    };

    // Hranimo track v vsakem primeru (tudi če ne barvamo)
    const prev = this.track.length ? this.track[this.track.length - 1] : null;
    if (prev){
      const d = haversine(prev, point);
      if (d < DEFAULTS.gpsMinDistM && (now - prev.t) < DEFAULTS.gpsMaxIntervalMs){
        return { painted: false, segmentM: 0 };
      }
      this.distanceM += d;
      if (prev.active && point.active) this.activeDistanceM += d;
    }

    if (this.track.length >= DEFAULTS.historyTrackMax){
      this.track.shift(); // cirkularno — ne eksplodiraj
    }
    this.track.push(point);

    const doPaint = this.shouldPaint(machineActive) && prev;
    let painted = false;
    let segM = 0;
    let stripCoords = null;

    if (doPaint){
      const sinceLast = now - this._lastPaintAt;
      const movedFromPaint = this._lastPaintPos
        ? haversine(this._lastPaintPos, point)
        : Infinity;
      if (sinceLast >= DEFAULTS.paintSampleMinMs || movedFromPaint >= 1.0){
        stripCoords = createStrip(prev, point, widthM);
        if (stripCoords){
          this.strips.push(stripCoords);
          const segDx = (point.lng - prev.lng) * 111320 * Math.cos(prev.lat * Math.PI/180);
          const segDy = (point.lat - prev.lat) * 111320;
          segM = Math.sqrt(segDx*segDx + segDy*segDy);
          this.coveredHa += (segM * widthM) / 10000;
          this.passes += 1;
          if (flow != null){
            if (this.flowTotal == null) this.flowTotal = 0;
            // Pretok interpretiramo kot trenutno stopnjo (npr. kg/ha ali l/min).
            // Za enostavnost seštejemo flow * dt (če je čas v sekundah)
            const dtS = prev ? (now - prev.t) / 1000 : 0;
            this.flowTotal += flow * dtS;
          }
          this._lastPaintAt = now;
          this._lastPaintPos = { lat: point.lat, lng: point.lng };
          painted = true;
        }
      }
    }
    return { painted, segmentM: segM, stripCoords };
  }

  // Auto-save varovalka (v IndexedDB vsakih N sekund, da preživi crash)
  async autoSaveIfDue(){
    const now = Date.now();
    if (now - this._lastSavedAt < DEFAULTS.autoSaveMs) return false;
    this._lastSavedAt = now;
    await this.persist();
    return true;
  }

  async persist(){
    const snapshot = this.toJSON();
    await saveSession(snapshot);
  }

  toJSON(){
    return {
      id: this.id,
      startedAt: this.startedAt,
      endedAt: this.endedAt,
      state: this.state,
      operation: { id: this.operation.id, name: this.operation.name, color: this.operation.color, icon: this.operation.icon, unit: this.operation.valueUnit, label: this.operation.valueLabel },
      machine: this.machine ? { id: this.machine.id, name: this.machine.name, width: this.machine.width, icon: this.machine.icon } : null,
      parcel: this.parcel ? { id: this.parcel.id, name: this.parcel.name, ha: this.parcel.ha, feature: this.parcel.feature || null } : null,
      note: this.note,
      abLine: this.abLine,
      track: this.track,
      strips: this.strips,
      coveredHa: this.coveredHa,
      distanceM: this.distanceM,
      activeDistanceM: this.activeDistanceM,
      durationMs: this.activeMsAccum,
      flowTotal: this.flowTotal,
      passes: this.passes
    };
  }
}
