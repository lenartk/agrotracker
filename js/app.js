// Glavni kontroler aplikacije. Upravlja:
//  - preklop med pogledi (home / map / history / settings)
//  - stanje seje (start/pause/stop/save)
//  - povezava GPS + BLE + karta + storage
//  - UI event wiring

import { OPERATIONS, MACHINES, DEFAULTS, GUIDANCE } from './constants.js';
import { Guidance, lineLabel } from './guidance.js';
import { MapController } from './map.js';
import { gps } from './gps.js';
import { ble } from './ble.js';
import { Session } from './session.js';
import {
  savedParcels, saveParcel, deleteParcel, clearParcels,
  savedSessions, saveSession, deleteSession, getSession,
  saveGerkLib, getGerkLib, clearGerkLib,
  savedLayers, saveLayer, deleteLayer,
  getKV, setKV, newId, storageEstimate
} from './storage.js';
import {
  featureHa, bboxOfFeature, centroidOfFeature, pointInFeature,
  formatDistance, formatDuration, fmtNum, offsetBack, trailedFollow, polygonAreaM2,
  pointInRing
} from './geo.js';
import {
  tilesForParcels, downloadTiles, tileCacheStats, clearTileCache, estimateTileCount
} from './offline.js';

// ============ STATE ============
const state = {
  view: 'home',
  parcels: [],
  session: null,
  map: null,
  guidance: new Guidance(),
  gerkLib: null,          // FeatureCollection vseh GERK-ov območja (lazy iz IndexedDB)
  telemetry: { active: null, width: null, flow: null, rs485ok: false, machine: null, lifted: null, alarm: 0, set: null, rpm: null, fuelLh: null },
  online: navigator.onLine,
  tileDownload: null,  // {abort, done, total} ko teče predprenos
  settings: {
    gpsSource: 'phone',
    simSpeedKmh: DEFAULTS.simSpeedKmh,
    workedOpacity: DEFAULTS.workedOpacity,
    widthOverride: null,
    autoSelectParcel: true,
    useBleMachineActive: true,
    useBleWidth: true,
    guidanceBeep: false,
    dayTheme: false,
    kmgMid: '',
  },
  // Home
  selectedOpId: 'seed',
  selectedMachineId: 'sejalnica',
  selectedParcelId: null,
  note: '',
  manualWork: true   // ročno stikalo "stroj dela" (ko ni BLE signala)
};

// ============ UTIL ============
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

let _toastTimer = null;
export function toast(msg, ms = 2300){
  const t = $('#toast');
  if (!t) return;
  t.textContent = msg;
  t.classList.add('show');
  if (_toastTimer) clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => t.classList.remove('show'), ms);
}

// Potrditveni dialog — nadomešča native confirm() (enoten videz)
function appConfirm(msg, { title = 'Potrditev', okLabel = 'V redu', danger = false, cancel = true } = {}){
  return new Promise(resolve => {
    $('#dlgTitle').textContent = title;
    $('#dlgMsg').textContent = msg;
    const ok = $('#dlgOk'), cancelBtn = $('#dlgCancel'), scrim = $('#dlgScrim');
    ok.textContent = okLabel;
    ok.className = 'minibtn' + (danger ? ' danger' : '');
    cancelBtn.style.display = cancel ? '' : 'none';
    const close = (val) => { scrim.classList.remove('open'); resolve(val); };
    ok.onclick = () => close(true);
    cancelBtn.onclick = () => close(false);
    scrim.onclick = (e) => { if (e.target === scrim) close(false); };
    scrim.classList.add('open');
  });
}
function appInfo(msg, title = 'Obvestilo'){ return appConfirm(msg, { title, cancel: false }); }

// Obrazec v dialogu: fields = [{key,label,type:'text'|'number'|'check',value,step?}]
// Vrne objekt vrednosti ali null (preklic).
function appForm(title, fields, okLabel = 'Shrani', preview = null){
  return new Promise(resolve => {
    $('#dlgTitle').textContent = title;
    const msg = $('#dlgMsg');
    msg.innerHTML = (preview ? '<div id="ffPreview"></div>' : '') + fields.map(f => {
      const id = 'ff_' + f.key;
      if (f.type === 'check'){
        return `<label class="toggle"><span>${f.label}</span><input type="checkbox" id="${id}" ${f.value ? 'checked' : ''}></label>`;
      }
      if (f.type === 'select'){
        const opts = (f.options || []).map(o =>
          `<option value="${o.v}" ${String(o.v) === String(f.value) ? 'selected' : ''}>${o.l}</option>`).join('');
        return `<div class="rowline tall" style="margin-bottom:4px"><span>${f.label}</span></div>
          <select id="${id}" style="margin-bottom:8px">${opts}</select>`;
      }
      const val = f.value != null ? String(f.value).replace(/"/g, '&quot;') : '';
      return `<div class="rowline tall" style="margin-bottom:4px"><span>${f.label}</span></div>
        <input type="${f.type || 'text'}" id="${id}" value="${val}" ${f.step ? `step="${f.step}"` : ''} style="margin-bottom:8px">`;
    }).join('');
    const ok = $('#dlgOk'), cancelBtn = $('#dlgCancel'), scrim = $('#dlgScrim');
    ok.textContent = okLabel;
    ok.className = 'minibtn';
    cancelBtn.style.display = '';
    const readVals = () => {
      const out = {};
      for (const f of fields){
        const el = document.getElementById('ff_' + f.key);
        if (!el) continue;
        if (f.type === 'check') out[f.key] = el.checked;
        else out[f.key] = el.value;
      }
      return out;
    };
    if (preview){
      const upd = () => { const pv = document.getElementById('ffPreview'); if (pv) pv.innerHTML = preview(readVals()); };
      setTimeout(() => {
        fields.forEach(f => {
          const el = document.getElementById('ff_' + f.key);
          if (el) el.addEventListener('input', upd);
          if (el && f.type === 'check') el.addEventListener('change', upd);
        });
        upd();
      }, 0);
    }
    const close = (val) => {
      scrim.classList.remove('open');
      msg.innerHTML = '';
      resolve(val);
    };
    ok.onclick = () => {
      const out = {};
      for (const f of fields){
        const el = document.getElementById('ff_' + f.key);
        if (f.type === 'check') out[f.key] = el.checked;
        else if (f.type === 'select') out[f.key] = el.value;
        else if (f.type === 'number'){
          const v = parseFloat(el.value.replace(',', '.'));
          out[f.key] = isFinite(v) ? v : null;
        } else out[f.key] = el.value.trim();
      }
      close(out);
    };
    cancelBtn.onclick = () => close(null);
    scrim.onclick = (e) => { if (e.target === scrim) close(null); };
    scrim.classList.add('open');
  });
}

const OP_COLORS = ['#38bdf8', '#f472b6', '#fb923c', '#a3e635', '#c084fc', '#2dd4bf', '#facc15'];

// Operacije in stroji: vgrajeni + uporabniški (nastavitve)
function allOperations(){
  const ovr = state.settings.opParams || {};
  const merged = {};
  for (const [k, op] of Object.entries(OPERATIONS)){
    merged[k] = ovr[k] ? { ...op, ...ovr[k] } : op;
  }
  for (const o of (state.settings.customOps || [])){
    merged[o.id] = {
      id: o.id, name: o.name, icon: '', svg: 'wrench',
      color: o.color || '#38bdf8', fillOpacity: 0.38,
      valueLabel: o.name, valueUnit: o.unit || '',
      hint: '', requiresActive: !!o.requiresActive,
      noPaint: !!o.noPaint, defaultMachines: []
    };
  }
  return merged;
}

function allMachines(){
  const ovr = state.settings.machineParams || {};
  const base = MACHINES.map(mch => ({ ...mch, ...(ovr[mch.id] || {}) }));
  const custom = (state.settings.customMachines || []).map(mch => ({ svg: 'wrench', ...mch }));
  return base.concat(custom);
}

// Dolg pritisk (550 ms) — odpre nastavitve/predogled; kratek klik ostane izbira
function bindLongPress(el, fn){
  let t = null, sx = 0, sy = 0, fired = false;
  el.addEventListener('pointerdown', (e) => {
    fired = false; sx = e.clientX; sy = e.clientY;
    t = setTimeout(() => { fired = true; navigator.vibrate?.(30); fn(); }, 550);
  });
  const cancel = () => { if (t){ clearTimeout(t); t = null; } };
  el.addEventListener('pointermove', (e) => {
    if (Math.hypot(e.clientX - sx, e.clientY - sy) > 12) cancel();
  });
  el.addEventListener('pointerup', cancel);
  el.addEventListener('pointerleave', cancel);
  el.addEventListener('click', (e) => {
    if (fired){ e.stopImmediatePropagation(); e.preventDefault(); }
  }, true);
  el.addEventListener('contextmenu', (e) => e.preventDefault());
}

const opSvg = (opId) => allOperations()[opId]?.svg || 'wrench';
const svgIcon = (name, cls = 'icon') => `<svg class="${cls}"><use href="#i-${name}"/></svg>`;

function showView(name){
  state.view = name;
  $$('.view').forEach(v => v.classList.remove('active'));
  const el = document.getElementById('view-' + name);
  if (el) el.classList.add('active');
  // Karta potrebuje invalidate size, ko pokažemo njen view
  if (name === 'map' && state.map){
    setTimeout(() => state.map && state.map.resize(), 50);
  }
  if (name === 'home') renderHome();
  if (name === 'history') renderHistory();
  if (name === 'settings') renderSettings();
}

function nowIso(){ return new Date().toISOString(); }
function fmtTs(ms){
  const d = new Date(ms);
  return d.toLocaleDateString('sl-SI') + ' ' + d.toLocaleTimeString('sl-SI', { hour: '2-digit', minute: '2-digit' });
}

// ============ INIT ============
function applyTheme(){
  document.documentElement.dataset.theme = state.settings.dayTheme ? 'day' : '';
  const mc = document.querySelector('meta[name=theme-color]');
  if (mc) mc.setAttribute('content', state.settings.dayTheme ? '#eef1ec' : '#0a0d0b');
}

async function init(){
  // Load settings
  const s = await getKV('settings');
  if (s) Object.assign(state.settings, s);
  applyTheme();

  // Load parcels (or demo if none saved)
  state.parcels = await savedParcels();
  if (state.parcels.length === 0){
    await loadDemoParcels();
  }

  // BLE events -> telemetry + UI
  ble.addEventListener('connect', (e) => {
    toast('BLE povezano: ' + (e.detail?.name || '?'));
    refreshBlePill();
  });
  ble.addEventListener('disconnect', () => {
    toast('BLE prekinjeno');
    state.telemetry.active = null;
    state.telemetry.width = null;
    refreshBlePill();
  });
  ble.addEventListener('msg:tel', (e) => {
    const m = e.detail;
    if (typeof m.active === 'number') state.telemetry.active = !!m.active;
    if (typeof m.w === 'number') state.telemetry.width = m.w;
    if (typeof m.flow === 'number') state.telemetry.flow = m.flow;
    if (typeof m.mach === 'string') state.telemetry.machine = m.mach;
    if (typeof m.rs485_ok === 'number') state.telemetry.rs485ok = !!m.rs485_ok;
    if (typeof m.lift === 'number') state.telemetry.lifted = !!m.lift;
    if (typeof m.alarm === 'number') state.telemetry.alarm = m.alarm;
    if (typeof m.set === 'number') state.telemetry.set = m.set;
    if (typeof m.rpm === 'number') state.telemetry.rpm = m.rpm;
    if (typeof m.fuellh === 'number') state.telemetry.fuelLh = m.fuellh;
    refreshTelemetryUI();
  });

  // GPS events
  gps.addEventListener('fix', (e) => onFix(e.detail));
  gps.addEventListener('error', (e) => {
    const r = e.detail?.reason;
    if (r === 'geo-err') toast('GPS napaka: ' + e.detail.message, 3500);
    if (r === 'no-geo')  toast('Brskalnik ne podpira GPS.');
  });
  gps.addEventListener('source-lost', () => {
    toast('BLE GPS izgubljen — preklop na telefon', 3000);
    setGpsSource('phone');
  });

  // Set initial GPS source
  if (state.settings.gpsSource !== 'sim'){
    gps.setSource(state.settings.gpsSource);
  } else {
    gps.setSource('sim');
  }

  // Online/offline events
  window.addEventListener('online',  () => { state.online = true;  refreshOnlinePill(); toast('Spletna povezava'); });
  window.addEventListener('offline', () => { state.online = false; refreshOnlinePill(); toast('Brez povezave (offline)'); });

  // Wire UI
  wireHome();
  wireMap();
  wireDrawer();
  wireHistoryView();
  wireSettingsView();

  // Default view
  renderHome();
  showView('home');
  refreshOnlinePill();

  // Register SW + samodejna posodobitev: ko novi SW prevzame nadzor,
  // stran enkrat osvežimo — uporabniku ni treba več "resetirati" aplikacije.
  if ('serviceWorker' in navigator){
    let _swRefreshing = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (_swRefreshing) return;
      _swRefreshing = true;
      location.reload();
    });
    navigator.serviceWorker.register('./sw.js').then(reg => {
      reg.addEventListener('updatefound', () => {
        const nw = reg.installing;
        if (nw) nw.addEventListener('statechange', () => {
          if (nw.state === 'installed') toast('Posodobitev prenesena — osvežujem…', 3000);
        });
      });
    }).catch(console.error);
  }

  // Prewarm karte: ustvari jo v ozadju in nalozi tile-e za parcele,
  // da je ob zacetku seje na voljo takoj (prej se je gradila sele takrat)
  setTimeout(() => {
    try {
      ensureMap();
      if (state.parcels.length) state.map.fitToAllParcels();
      if (state.settings.activeLayerId) activateLayer(state.settings.activeLayerId);
    } catch (e){ console.warn('map prewarm', e); }
  }, 700);

  // Ask for persistence (proti izpraznjenju storage-a)
  if (navigator.storage && navigator.storage.persist){
    navigator.storage.persisted().then(p => { if (!p) navigator.storage.persist(); });
  }
}

async function loadDemoParcels(){
  try {
    const r = await fetch('./data/demo-parcels.geojson');
    const gj = await r.json();
    for (const f of gj.features){
      const p = {
        id: f.properties?.id || newId('par'),
        name: f.properties?.name || 'Parcela',
        ha: f.properties?.ha ?? featureHa(f),
        feature: f,
        source: 'demo',
        createdAt: Date.now()
      };
      await saveParcel(p);
      state.parcels.push(p);
    }
  } catch (e){ console.warn('Demo parcele niso bile naložene', e); }
}

// ============ PREKRIVANJE (kje sem že delal) ============
// Groba mreža ~4 m celic pokritega območja — poceni opozorilo "tu si že delal".
// ponytail: hevristika po srednici pasu; za cm natančnost bi rabili pravi
// prostorski indeks — nadgradnja, če se na terenu izkaže potreba.
const OVERLAP_CELL_M = 4;
let _covGrid = new Set();
let _lastOverlapToastAt = 0;
let _overlapHits = 0; // debug/diagnostika

function _cellKey(lat, lng){
  const ky = Math.round(lat * 111320 / OVERLAP_CELL_M);
  const kx = Math.round(lng * 111320 * Math.cos(lat * Math.PI / 180) / OVERLAP_CELL_M);
  return ky + ':' + kx;
}

const OVERLAP_RECENT = 14; // celic "sveže sledi", ki se ne štejejo kot prekrivanje
let _recentCells = [];

function overlapResetAndSeed(prevStrips){
  _covGrid = new Set();
  _recentCells = [];
  (prevStrips || []).forEach(quad => {
    // vogali + središče traku — dovolj za opozorilo
    let cx = 0, cy = 0;
    quad.forEach(p => { cy += p[0]; cx += p[1]; _covGrid.add(_cellKey(p[0], p[1])); });
    _covGrid.add(_cellKey(cy / quad.length, cx / quad.length));
  });
}

// Označi srednico pobarvanega segmenta; prekrivanje = zadeta STARA pokritost
// (celice sveže sledi — pravkar prevoženo — se ne štejejo, sicer bi alarmiralo
// med normalno vožnjo naprej).
function overlapMarkAndCheck(from, to){
  const dLat = to.lat - from.lat, dLng = to.lng - from.lng;
  const distM = Math.hypot(dLat * 111320, dLng * 111320 * Math.cos(from.lat * Math.PI / 180));
  const steps = Math.max(1, Math.round(distM / (OVERLAP_CELL_M * 0.75)));
  let overlap = false;
  for (let i = 0; i <= steps; i++){
    const k = _cellKey(from.lat + dLat * i / steps, from.lng + dLng * i / steps);
    if (_covGrid.has(k)){
      if (!_recentCells.includes(k)) overlap = true;
    } else {
      _covGrid.add(k);
    }
    if (_recentCells[_recentCells.length - 1] !== k){
      _recentCells.push(k);
      if (_recentCells.length > OVERLAP_RECENT) _recentCells.shift();
    }
  }
  if (overlap) _overlapHits++;
  return overlap;
}

// ============ IZVOZ PO PARCELI / ANALIZA OBMOČJA ============
// "Koliko gnojila je padlo na to površino" — po parceli ali narisanem delu.
// Količina traku = površina traku (ha) × odmerek ob barvanju (stripMeta.f);
// za starejše seje brez stripMeta vzamemo povprečje seje.

function quadAreaM2(q){
  const ring = q.map(p => [p[1], p[0]]);
  ring.push(ring[0]);
  return polygonAreaM2(ring);
}

function sessionAvgRate(s){
  const vals = (s.track || []).filter(p => p.active && p.flow != null).map(p => p.flow);
  if (!vals.length) return null;
  return vals.reduce((x, y) => x + y, 0) / vals.length;
}

// zbere uporabo po operacijah za trakove, ki ustrezajo filtru (fn(quad, i, s) -> bool)
function collectUsage(sessions, stripFilter){
  const byOp = {};
  const feats = [];
  for (const s of sessions){
    const avg = sessionAvgRate(s);
    const unit = s.operation?.unit || '';
    (s.strips || []).forEach((q, i) => {
      if (stripFilter && !stripFilter(q, i, s)) return;
      const areaHa = quadAreaM2(q) / 10000;
      const rate = s.stripMeta?.[i]?.f ?? avg;
      const amount = rate != null ? areaHa * rate : null;
      const key = s.operation?.id || 'custom';
      byOp[key] = byOp[key] || { name: s.operation?.name || '?', unit, ha: 0, amount: 0, hasRate: false, sessions: new Set() };
      byOp[key].ha += areaHa;
      if (amount != null){ byOp[key].amount += amount; byOp[key].hasRate = true; }
      byOp[key].sessions.add(s.id);
      feats.push({
        type: 'Feature',
        properties: {
          kind: 'coverage', operation: s.operation?.name, operationId: s.operation?.id,
          date: new Date(s.startedAt).toISOString().slice(0, 10),
          sessionId: s.id, gerkPid: s.parcel?.gerkPid ?? null,
          areaHa: +areaHa.toFixed(5),
          rate: rate != null ? +rate.toFixed(2) : null,
          amount: amount != null ? +amount.toFixed(3) : null,
          unit
        },
        geometry: { type: 'Polygon', coordinates: [q.map(p => [p[1], p[0]]).concat([[q[0][1], q[0][0]]])] }
      });
    });
  }
  return { byOp, feats };
}

function usageSummaryHtml(byOp){
  const rows = Object.values(byOp).map(o => {
    const amountTxt = o.hasRate ? `${fmtNum(o.amount, 1)} ${o.unit.replace('/ha', '') || ''}` : '—';
    return `<div class="rowline"><span class="small">${escapeHtml(o.name)}</span>
      <strong>${fmtNum(o.ha, 3)} ha · ${amountTxt}</strong></div>`;
  }).join('');
  return rows || '<div class="small muted">Na tem območju ni zabeleženega dela.</div>';
}

async function exportParcelReport(parcelId){
  const all = await savedSessions();
  const mine = all.filter(s => s.parcel?.id === parcelId);
  if (!mine.length){ toast('Za to parcelo ni sej.'); return; }
  const parcel = mine[0].parcel;
  const { byOp, feats } = collectUsage(mine, null);
  const totals = {};
  Object.entries(byOp).forEach(([k, o]) => {
    totals[k] = { operacija: o.name, ha: +o.ha.toFixed(3),
                  kolicina: o.hasRate ? +o.amount.toFixed(2) : null,
                  enota: o.unit, sej: o.sessions.size };
  });
  const fc = {
    type: 'FeatureCollection',
    features: [
      ...(parcel.feature ? [{
        type: 'Feature',
        properties: { kind: 'parcel', name: parcel.name, gerkPid: parcel.gerkPid ?? null,
                      ha: parcel.ha, totals },
        geometry: parcel.feature.geometry
      }] : []),
      ...feats
    ]
  };
  const blob = new Blob([JSON.stringify(fc)], { type: 'application/geo+json' });
  downloadBlob(blob, `parcela-${(parcel.gerkPid || parcel.name || 'izvoz').toString().replace(/\s+/g, '_')}-porocilo.geojson`);
  await appInfo('Izvoženo: pokritost z odmerki po trakovih + povzetek po operacijah v lastnostih parcele. Uvozi v QGIS/drug program.', 'Izvoz parcele');
}

// --- risanje območja za analizo ---
let _selPts = null;
let _selClickBound = null;

function startAreaAnalysis(){
  if (state.session && state.session.state === 'running'){
    appInfo('Med aktivno sejo analiza ni na voljo.', 'Seja teče');
    return;
  }
  ensureMap();
  showView('map');
  _selPts = [];
  state.map.setFollow(false);
  const start = $('#startBtn'), pause = $('#pauseBtn'), stop = $('#stopBtn');
  start.textContent = 'Razveljavi točko';
  start.className = 'bigbtn secondary';
  start.disabled = false;
  start.onclick = () => { _selPts.pop(); state.map.setSelection(_selPts); };
  pause.textContent = 'Zaključi';
  pause.className = 'bigbtn primary';
  pause.disabled = false;
  pause.onclick = () => finishAreaAnalysis();
  stop.textContent = 'Prekliči';
  stop.className = 'bigbtn stop';
  stop.disabled = false;
  stop.onclick = () => exitAreaAnalysis();
  _selClickBound = (e) => {
    _selPts.push([e.lngLat.lat, e.lngLat.lng]);
    state.map.setSelection(_selPts);
    navigator.vibrate?.(15);
  };
  state.map.map.on('click', _selClickBound);
  $('#mapParcelName').textContent = 'ANALIZA: tapkaj oglišča območja';
  toast('Tapni po karti oglišča območja, nato Zaključi.', 4000);
}

async function finishAreaAnalysis(){
  if (!_selPts || _selPts.length < 3){ toast('Vsaj 3 točke.'); return; }
  const ring = _selPts.map(p => [p[1], p[0]]); // [lng,lat] za pointInRing
  const all = await savedSessions();
  const { byOp, feats } = collectUsage(all, (q) => {
    const c = stripCentroid(q);
    return pointInRing({ lat: c.lat, lng: c.lng }, ring);
  });
  const selRing = ring.concat([ring[0]]);
  const areaHa = polygonAreaM2(selRing) / 10000;
  const body = usageSummaryHtml(byOp);
  $('#dlgTitle').textContent = 'Analiza območja (' + fmtNum(areaHa, 2) + ' ha)';
  $('#dlgMsg').innerHTML = body;
  const ok = $('#dlgOk'), cancelBtn = $('#dlgCancel'), scrim = $('#dlgScrim');
  ok.textContent = 'Izvozi GeoJSON';
  ok.className = 'minibtn';
  cancelBtn.style.display = '';
  cancelBtn.textContent = 'Zapri';
  const close = () => { scrim.classList.remove('open'); $('#dlgMsg').innerHTML = ''; cancelBtn.textContent = 'Prekliči'; };
  ok.onclick = () => {
    const totals = {};
    Object.entries(byOp).forEach(([k, o]) => {
      totals[k] = { operacija: o.name, ha: +o.ha.toFixed(3),
                    kolicina: o.hasRate ? +o.amount.toFixed(2) : null, enota: o.unit };
    });
    const fc = { type: 'FeatureCollection', features: [
      { type: 'Feature', properties: { kind: 'selection', areaHa: +areaHa.toFixed(3), totals },
        geometry: { type: 'Polygon', coordinates: [selRing] } },
      ...feats
    ]};
    downloadBlob(new Blob([JSON.stringify(fc)], { type: 'application/geo+json' }),
      'obmocje-porocilo.geojson');
    close();
    exitAreaAnalysis();
  };
  cancelBtn.onclick = () => { close(); };
  scrim.onclick = (e) => { if (e.target === scrim) close(); };
  scrim.classList.add('open');
}

function exitAreaAnalysis(){
  if (_selClickBound){ state.map.map.off('click', _selClickBound); _selClickBound = null; }
  _selPts = null;
  state.map.setSelection(null);
  setTrackingUI('idle');
  wireMapButtons();
  $('#mapParcelName').textContent = '—';
}

// ============ POPRAVLJANJE SEJ (prikaz + radialni brisalec) ============
// Iz zgodovine: sejo pokažemo na karti; v načinu brisanja tap odstrani trakove
// v radiju, ha se preračuna, Shrani zapiše nazaj v IndexedDB.

let _editS = null;          // seja v urejanju (kopija iz DB)
let _editUndo = [];         // sklad izbrisanih [{idx, strip}] po korakih
let _editClickBound = null;

function stripCentroid(quad){
  let la = 0, ln = 0;
  quad.forEach(p => { la += p[0]; ln += p[1]; });
  return { lat: la / quad.length, lng: ln / quad.length };
}

function recomputeSessionHa(s){
  let m2 = 0;
  for (const q of (s.strips || [])){
    const ring = q.map(p => [p[1], p[0]]);
    ring.push(ring[0]);
    m2 += polygonAreaM2(ring);
  }
  s.coveredHa = m2 / 10000;
  return s.coveredHa;
}

function editRenderStrips(){
  const color = _editS.operation?.color || '#22c55e';
  state.map.loadPrevCoverage(_editS.strips || [], color);
}

async function openSessionOnMap(id, editMode){
  if (state.session && state.session.state === 'running'){
    appInfo('Med aktivno sejo urejanje ni mogoče. Najprej shrani.', 'Seja teče');
    return;
  }
  const s = await getSession(id);
  if (!s) return;
  closeModal();
  ensureMap();
  showView('map');
  state.map.clearCoverage();
  state.map.clearPrevCoverage();
  state.map.clearGuidance();
  _editS = s;
  _editUndo = [];
  editRenderStrips();
  // pot
  if (s.track?.length > 1){
    state.map.setDriveStyle(1.6, '#ffffff');
    for (let i = 1; i < s.track.length; i++){
      state.map.paintDrive(s.track[i-1], s.track[i]);
    }
  }
  // fit na sejo
  const pts = (s.strips?.length ? s.strips.flat() : (s.track || []).map(p => [p.lat, p.lng]));
  if (pts.length){
    let mnLa = 90, mxLa = -90, mnLo = 180, mxLo = -180;
    pts.forEach(p => {
      const la = p.lat ?? p[0], lo = p.lng ?? p[1];
      if (la < mnLa) mnLa = la; if (la > mxLa) mxLa = la;
      if (lo < mnLo) mnLo = lo; if (lo > mxLo) mxLo = lo;
    });
    state.map.setFollow(false);
    state.map.map.fitBounds([[mnLo, mnLa], [mxLo, mxLa]], { padding: 60, duration: 400 });
  }
  $('#mapParcelName').textContent = (editMode ? 'UREJANJE: ' : 'Ogled: ') + (s.parcel?.name || s.operation?.name || 'seja');
  $('#mapMachineName').textContent = fmtTs(s.startedAt) + ' · ' + fmtNum(s.coveredHa || 0, 3) + ' ha';

  if (editMode) enterEditMode();
  else exitEditMode(false);
}

function enterEditMode(){
  const start = $('#startBtn'), pause = $('#pauseBtn'), stop = $('#stopBtn');
  start.textContent = 'Razveljavi';
  start.className = 'bigbtn secondary';
  start.disabled = false;
  start.onclick = () => {
    const last = _editUndo.pop();
    if (!last){ toast('Ni kaj razveljaviti.'); return; }
    last.forEach(x => _editS.strips.splice(x.idx, 0, x.strip));
    editRenderStrips();
    updateEditHa();
  };
  pause.textContent = 'Shrani';
  pause.className = 'bigbtn primary';
  pause.disabled = false;
  pause.onclick = async () => {
    recomputeSessionHa(_editS);
    await saveSession(_editS);
    toast('Popravki shranjeni: ' + fmtNum(_editS.coveredHa, 3) + ' ha');
    exitEditView();
  };
  stop.textContent = 'Prekliči';
  stop.className = 'bigbtn stop';
  stop.disabled = false;
  stop.onclick = () => exitEditView();

  // tap po karti briše v radiju delovne širine
  const radius = Math.max(3, (_editS.machine?.width || 3));
  _editClickBound = (e) => {
    const c = { lat: e.lngLat.lat, lng: e.lngLat.lng };
    const removed = [];
    for (let i = _editS.strips.length - 1; i >= 0; i--){
      const cen = stripCentroid(_editS.strips[i]);
      const dx = (cen.lng - c.lng) * 111320 * Math.cos(c.lat * Math.PI / 180);
      const dy = (cen.lat - c.lat) * 111320;
      if (dx*dx + dy*dy <= radius * radius){
        removed.push({ idx: i, strip: _editS.strips[i] });
        _editS.strips.splice(i, 1);
      }
    }
    if (removed.length){
      _editUndo.push(removed.reverse());
      editRenderStrips();
      updateEditHa();
      navigator.vibrate?.(20);
    }
  };
  state.map.map.on('click', _editClickBound);
  toast('Brisanje: tapni po pobarvanem (radij ' + fmtNum(radius, 0) + ' m).', 4000);
}

function updateEditHa(){
  recomputeSessionHa(_editS);
  $('#mapMachineName').textContent = fmtTs(_editS.startedAt) + ' · ' + fmtNum(_editS.coveredHa, 3) + ' ha';
}

function exitEditMode(clear = true){
  if (_editClickBound){ state.map.map.off('click', _editClickBound); _editClickBound = null; }
  if (clear){ _editS = null; _editUndo = []; }
}

function exitEditView(){
  exitEditMode(true);
  state.map.clearPrevCoverage();
  state.map.clearCoverage();
  setTrackingUI('idle');
  // povrni privzete handlerje tipk
  wireMapButtons();
  showView('history');
}

// ============ SLOJI: analize prsti / predpisne karte ============
// Sloj = GeoJSON s številčno lastnostjo -> barvna lestvica na karti.
// kind 'rx' = predpisna karta: vrednost je ciljni odmerek; ob GPS prehodu cone
// se cilj pokaže v HUD in pošlje modulu (BLE) — stroj ga bo uporabil, ko bo
// firmware sejalnice sprejel "rate" okvir (glej PROJECT.md vizija).

let _activeLayer = null;   // {id,name,prop,kind,fc}
let _lastRxRate = null;
let _lastRxSentAt = 0;

function layerColor(v, mn, mx){
  const t = mx > mn ? Math.max(0, Math.min(1, (v - mn) / (mx - mn))) : 0.5;
  // modra (malo) -> zelena -> rdeča (veliko)
  const stops = [[37, 99, 235], [34, 197, 94], [239, 68, 68]];
  const seg = t < 0.5 ? 0 : 1;
  const tt = (t - seg * 0.5) * 2;
  const c = stops[seg].map((s, i) => Math.round(s + (stops[seg + 1][i] - s) * tt));
  return 'rgb(' + c.join(',') + ')';
}

async function activateLayer(id){
  if (!id){ _activeLayer = null; state.map?.setOverlay([]); return; }
  const all = await savedLayers();
  const l = all.find(x => x.id === id);
  if (!l){ _activeLayer = null; state.map?.setOverlay([]); return; }
  _activeLayer = l;
  const vals = l.fc.features.map(f => +f.properties?.[l.prop]).filter(v => isFinite(v));
  const mn = Math.min(...vals), mx = Math.max(...vals);
  const feats = l.fc.features.map(f => ({
    ...f,
    properties: { ...f.properties, _c: layerColor(+f.properties?.[l.prop], mn, mx) }
  }));
  ensureMap();
  state.map.setOverlay(feats);
  toast(`Sloj: ${l.name} (${l.prop}: ${fmtNum(mn, 1)}–${fmtNum(mx, 1)})`, 3000);
}

async function importLayerFile(file){
  const gj = JSON.parse(await file.text());
  const feats = (gj.type === 'FeatureCollection' ? gj.features : [gj]).filter(f => f?.geometry);
  if (!feats.length) throw new Error('Ni veljavnih geometrij.');
  // predlagaj prvo številčno lastnost
  const props = Object.keys(feats[0].properties || {});
  const firstNum = props.find(k => isFinite(+feats[0].properties[k])) || '';
  const f = await appForm('Nov sloj', [
    { key: 'name', label: 'Ime sloja (npr. pH 2026, Odmerek N)', type: 'text', value: file.name.replace(/\.(geo)?json$/i, '') },
    { key: 'prop', label: `Lastnost z vrednostjo (na voljo: ${props.slice(0, 6).join(', ')})`, type: 'text', value: firstNum },
    { key: 'rx', label: 'Predpisna karta (vrednost = ciljni odmerek)', type: 'check', value: false }
  ], 'Uvozi');
  if (!f || !f.prop) return null;
  const layer = { id: newId('lay'), name: f.name || 'Sloj', prop: f.prop,
                  kind: f.rx ? 'rx' : 'overlay',
                  fc: { type: 'FeatureCollection', features: feats } };
  await saveLayer(layer);
  return layer;
}

async function renderLayersList(){
  const el = $('#settingsLayersList');
  if (!el) return;
  const all = await savedLayers();
  const act = state.settings.activeLayerId;
  el.innerHTML = all.length ? all.map(l => `
    <div class="rowline">
      <label class="toggle" style="margin:0;flex:1">
        <span>${escapeHtml(l.name)} <span class="small muted">${l.prop}${l.kind === 'rx' ? ' · predpisna' : ''}</span></span>
        <input type="radio" name="layAct" value="${l.id}" ${act === l.id ? 'checked' : ''}>
      </label>
      <button class="minibtn danger" data-del="${l.id}" style="padding:6px 10px">✕</button>
    </div>`).join('') + `
    <label class="toggle"><span class="small muted">Brez sloja</span><input type="radio" name="layAct" value="" ${!act ? 'checked' : ''}></label>`
    : '<div class="small muted">Ni slojev. Uvozi GeoJSON z analizami ali odmerki.</div>';
  el.querySelectorAll('input[name=layAct]').forEach(r => {
    r.onchange = async () => {
      state.settings.activeLayerId = r.value || null;
      await persistSettings();
      activateLayer(r.value || null);
    };
  });
  el.querySelectorAll('button[data-del]').forEach(b => {
    b.onclick = async () => {
      if (!await appConfirm('Izbrišem sloj?', { okLabel: 'Izbriši', danger: true })) return;
      await deleteLayer(b.dataset.del);
      if (state.settings.activeLayerId === b.dataset.del){
        state.settings.activeLayerId = null;
        activateLayer(null);
        await persistSettings();
      }
      renderLayersList();
    };
  });
}

// Ob GPS fixu: če je aktivna predpisna karta, določi ciljni odmerek cone
function rxOnFix(fix){
  const el = $('#rxTarget');
  if (!_activeLayer || _activeLayer.kind !== 'rx'){
    if (el) el.textContent = '';
    return;
  }
  const hit = _activeLayer.fc.features.find(f => pointInFeature(fix, f));
  const rate = hit ? +hit.properties?.[_activeLayer.prop] : null;
  if (el) el.textContent = rate != null && isFinite(rate) ? `· cilj ${fmtNum(rate, 1)}` : '· izven con';
  if (rate != null && isFinite(rate) && rate !== _lastRxRate && Date.now() - _lastRxSentAt > 2000){
    _lastRxRate = rate;
    _lastRxSentAt = Date.now();
    if (ble.connected){
      ble.send({ c: 'rate', v: rate });
      toast('Ciljni odmerek → modul: ' + fmtNum(rate, 1), 2000);
    }
  }
}

// ============ GERK KNJIŽNICA ============
// "Kontra smer": stojiš na parceli -> app v lokalni knjižnici območja najde GERK
// pod tabo in ga doda med parcele. Brez strežnika, deluje offline.

async function ensureGerkLib(){
  if (state.gerkLib === null){
    state.gerkLib = await getGerkLib() || { type: 'FeatureCollection', features: [] };
  }
  return state.gerkLib;
}

function findGerkAt(ll, lib){
  if (!lib || !lib.features) return null;
  return lib.features.find(f => pointInFeature(ll, f)) || null;
}

function parcelFromGerkFeature(f){
  return {
    id: 'gerk_' + (f.properties?.GERK_PID ?? newId('par')),
    name: f.properties?.name || f.properties?.DOMACE_IME ||
          (f.properties?.GERK_PID ? 'GERK ' + f.properties.GERK_PID : 'Parcela'),
    ha: f.properties?.ha ?? featureHa(f),
    feature: f,
    gerkPid: f.properties?.GERK_PID ?? null,
    raba: f.properties?.RABA_ID ?? null,
    source: 'gerklib',
    createdAt: Date.now()
  };
}

// Doda GERK na trenutni GPS poziciji (če ga knjižnica pozna in ga še nimamo)
async function addGerkAtCurrentPosition({ silent = false } = {}){
  const f = gps.lastFix;
  if (!f){ if (!silent) toast('Ni GPS pozicije.'); return null; }
  const lib = await ensureGerkLib();
  if (!lib.features.length){
    if (!silent) await appInfo('GERK knjižnica je prazna. V Nastavitvah uvozi datoteko območja (tools/gerk_extract.py --obmocje-km).', 'GERK knjižnica');
    return null;
  }
  const hit = findGerkAt({ lat: f.lat, lng: f.lng }, lib);
  if (!hit){ if (!silent) toast('Na tej poziciji ni GERK-a v knjižnici.'); return null; }
  const pid = hit.properties?.GERK_PID;
  const existing = state.parcels.find(p => p.gerkPid && pid && p.gerkPid === pid);
  if (existing){
    state.selectedParcelId = existing.id;
    if (state.map){ state.map.highlightParcel(existing.id); }
    if (!silent) toast('GERK ' + pid + ' je že med parcelami — izbran.');
    return existing;
  }
  const ime = hit.properties?.name || hit.properties?.DOMACE_IME || ('GERK ' + (pid ?? '?'));
  const ha = hit.properties?.ha ?? featureHa(hit);
  const ok = await appConfirm(
    `Stojiš na: ${ime}` + (pid ? ` (GERK ${pid})` : '') + `, ${fmtNum(ha, 2)} ha. Dodam med parcele?`,
    { title: 'GERK najden', okLabel: 'Dodaj' });
  if (!ok) return null;
  const p = parcelFromGerkFeature(hit);
  await saveParcel(p);
  state.parcels.push(p);
  state.selectedParcelId = p.id;
  refreshParcelsOnMap();
  if (state.map) state.map.highlightParcel(p.id);
  if (state.session && !state.session.parcel) state.session.parcel = p;
  toast('Dodano: ' + p.name);
  return p;
}

// Uvoz GERK podatkov območja: vse v knjižnico; tvoje (po KMG-MID) takoj med parcele
async function importGerkArea(file){
  const gj = JSON.parse(await file.text());
  return importGerkData(gj);
}

async function importGerkData(gj){
  const feats = (gj.type === 'FeatureCollection' ? gj.features : [gj])
    .filter(f => f?.geometry && (f.geometry.type === 'Polygon' || f.geometry.type === 'MultiPolygon'));
  if (!feats.length) throw new Error('Ni veljavnih poligonov.');
  await saveGerkLib({ type: 'FeatureCollection', features: feats });
  state.gerkLib = { type: 'FeatureCollection', features: feats };

  let added = 0;
  const mid = (state.settings.kmgMid || '').trim();
  if (mid){
    for (const f of feats){
      if (String(f.properties?.KMG_MID ?? '').trim() !== mid) continue;
      const pid = f.properties?.GERK_PID;
      if (state.parcels.find(p => p.gerkPid && pid && p.gerkPid === pid)) continue;
      const p = parcelFromGerkFeature(f);
      await saveParcel(p);
      state.parcels.push(p);
      added++;
    }
  }
  refreshParcelsOnMap?.();
  return { lib: feats.length, added, mid };
}

// ============ HOME VIEW ============
function renderHome(){
  // Operacije
  const opGrid = $('#opGrid');
  opGrid.innerHTML = Object.values(allOperations()).map(op => `
    <button class="op-card ${state.selectedOpId === op.id ? 'selected' : ''}" data-id="${op.id}">
      <div class="op-icon" style="color:${op.color};background:${op.color}18;border:1px solid ${op.color}55">${svgIcon(op.svg || 'wrench')}</div>
      <div class="op-name">${op.name}</div>
      <div class="op-desc">${op.valueLabel}${op.valueUnit ? ' • ' + op.valueUnit : ''}</div>
    </button>
  `).join('');
  opGrid.querySelectorAll('.op-card').forEach(btn => {
    btn.onclick = () => { state.selectedOpId = btn.dataset.id; autoPickMachineForOp(); renderHome(); };
    bindLongPress(btn, () => editOperation(btn.dataset.id));
  });

  // Stroji
  const machRow = $('#machineRow');
  machRow.innerHTML = allMachines().map(m => `
    <button class="picker-chip ${state.selectedMachineId === m.id ? 'selected' : ''}" data-id="${m.id}">
      <span>${m.name}</span>
      <small>${fmtNum(m.width, 1)} m</small>
    </button>
  `).join('');
  machRow.querySelectorAll('.picker-chip').forEach(btn => {
    btn.onclick = () => {
      state.selectedMachineId = btn.dataset.id;
      // stroj s sabo prinese privzeti tip dela (lahko ga potem ročno zamenjaš)
      const dm = allMachines().find(x => x.id === btn.dataset.id);
      if (dm?.defaultOp && allOperations()[dm.defaultOp]) state.selectedOpId = dm.defaultOp;
      renderHome();
    };
    bindLongPress(btn, () => editMachine(btn.dataset.id));
  });

  // Parcele
  const parcelRow = $('#parcelRow');
  if (state.parcels.length === 0){
    parcelRow.innerHTML = '<div class="empty-state small">Ni parcel. Uvozi GeoJSON v nastavitvah.</div>';
  } else {
    parcelRow.innerHTML = state.parcels.map(p => `
      <button class="picker-chip ${state.selectedParcelId === p.id ? 'selected' : ''}" data-id="${p.id}">
        <span>${escapeHtml(p.name)}</span>
        <small>${fmtNum(p.ha, 2)} ha</small>
      </button>
    `).join('');
    parcelRow.querySelectorAll('.picker-chip').forEach(btn => {
      btn.onclick = () => { state.selectedParcelId = btn.dataset.id; renderHome(); };
      bindLongPress(btn, () => showParcelOnMap(btn.dataset.id));
    });
  }

  // Note
  $('#homeNote').value = state.note;

  // Start button enabled?
  const startBtn = $('#homeStartBtn');
  startBtn.disabled = !(state.selectedOpId && state.selectedMachineId);

  renderSeasonStats().catch(()=>{});
}

// Statistika tekoče sezone (koledarsko leto) po operacijah
async function renderSeasonStats(){
  const year = new Date().getFullYear();
  $('#seasonYear').textContent = year;
  const all = await savedSessions();
  const inYear = all.filter(s => new Date(s.startedAt).getFullYear() === year);
  const grid = $('#seasonGrid');
  if (!inYear.length){
    grid.innerHTML = '<div class="empty-state small">Še ni podatkov za to leto.</div>';
    return;
  }
  const byOp = {};
  let totalHa = 0, totalMs = 0;
  for (const s of inYear){
    const id = s.operation?.id || 'custom';
    byOp[id] = byOp[id] || { op: s.operation, ha: 0, n: 0 };
    byOp[id].ha += s.coveredHa || 0;
    byOp[id].n += 1;
    totalHa += s.coveredHa || 0;
    totalMs += s.durationMs || 0;
  }
  grid.innerHTML = Object.values(byOp).map(x => `
    <div class="season-item" style="border-left-color:${x.op?.color || '#22c55e'}">
      <div class="season-op" style="color:${x.op?.color || 'inherit'}">${svgIcon(opSvg(x.op?.id), 'icon sm')}</div>
      <div class="season-name">${escapeHtml(x.op?.name || '?')}</div>
      <div class="season-ha">${fmtNum(x.ha, 1)} <span>ha</span></div>
      <div class="season-n">${x.n}×</div>
    </div>
  `).join('') + `
    <div class="season-item total">
      <div class="season-name" style="flex:1">Skupaj</div>
      <div class="season-ha">${fmtNum(totalHa, 1)} <span>ha</span></div>
      <div class="season-n">${formatDuration(totalMs)}</div>
    </div>`;
}

function autoPickMachineForOp(){
  const op = allOperations()[state.selectedOpId];
  if (!op || !op.defaultMachines?.length) return;
  // Če trenutno izbran stroj ni med priporočenimi, preklopi na prvega priporočenega
  if (!op.defaultMachines.includes(state.selectedMachineId)){
    state.selectedMachineId = op.defaultMachines[0];
  }
}

function wireHome(){
  $('#homeSettingsBtn').onclick = () => showView('settings');
  $('#homeHistoryBtn').onclick = () => showView('history');
  $('#homeHistoryBtn2').onclick = () => showView('history');
  $('#homeSettingsBtn2').onclick = () => showView('settings');
  $('#homeInstallBtn').onclick = () => appInfo('V meniju brskalnika (⋮) izberi "Dodaj na začetni zaslon" oz. "Namesti aplikacijo".', 'Namestitev');
  $('#homeMapBtn').onclick = () => {
    ensureMap();
    showView('map');
    if (!state.session) $('#mapParcelName').textContent = 'Prosti pregled';
  };
  $('#homeNote').addEventListener('input', e => state.note = e.target.value);

  $('#homeStartBtn').onclick = () => startSession();
}

function escapeHtml(s){
  return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

// ============ MAP VIEW ============
function ensureMap(){
  if (state.map) {
    refreshParcelsOnMap();
    return state.map;
  }
  state.map = new MapController($('#map'), { center: DEFAULTS.center, zoom: DEFAULTS.zoom });

  state.map.onFollowChange = (on) => {
    $('#mapCenterBtn').classList.toggle('on', on);
  };
  $('#mapCenterBtn').classList.toggle('on', state.map.follow);

  state.map.onParcelClick = (id) => {
    if (_editS) return; // med urejanjem seje klik na parcelo ne sme zoomirati
    state.selectedParcelId = id;
    state.map.highlightParcel(id);
    state.map.fitToParcel(id);
    $('#mapParcelName').textContent = state.parcels.find(p => p.id === id)?.name || 'Parcela';
  };

  refreshParcelsOnMap();

  // Ročna sim: vleci prst za cilj (samo če je source === 'sim')
  const mapEl = $('#map');
  let pointerDown = false;
  mapEl.addEventListener('pointerdown', (ev) => {
    if (gps.source !== 'sim') return;
    pointerDown = true; setSimTargetFromPointer(ev);
  });
  mapEl.addEventListener('pointermove', (ev) => {
    if (!pointerDown || gps.source !== 'sim') return;
    setSimTargetFromPointer(ev);
  });
  window.addEventListener('pointerup', () => pointerDown = false);
  state.map.map.on('click', (e) => {
    if (gps.source !== 'sim') return;
    gps.setSimTarget({ lat: e.lngLat.lat, lng: e.lngLat.lng });
  });

  return state.map;
}

function refreshParcelsOnMap(){
  if (!state.map) return;
  state.map.setParcels(state.parcels, state.selectedParcelId);
}

function setSimTargetFromPointer(ev){
  if (!state.map) return;
  const rect = ev.currentTarget.getBoundingClientRect();
  const x = ev.clientX - rect.left, y = ev.clientY - rect.top;
  const ll = state.map.map.unproject([x, y]);
  gps.setSimTarget({ lat: ll.lat, lng: ll.lng });
}

function wireMap(){
  $('#mapMenuBtn').onclick = () => openDrawer();
  $('#mapCenterBtn').onclick = () => {
    const f = gps.lastFix;
    if (f){
      state.map.setFollow(true);
      state.map.centerOn([f.lat, f.lng]);
    }
    else if (state.selectedParcelId) state.map.fitToParcel(state.selectedParcelId);
    else state.map.fitToAllParcels();
  };
  $('#mapTerrainBtn').onclick = () => {
    const onSat = state.map.toggleSatellite();
    toast(onSat ? 'Satelit' : 'Zemljevid');
  };
  $('#map3dBtn').onclick = () => {
    const on = state.map.setMode3D(!state.map.is3D);
    $('#map3dBtn').classList.toggle('on3d', on);
    toast(on ? '3D pogled (teren)' : '2D pogled');
  };


  wireMapButtons();

  initLightbar();
  $('#mapAbBtn').onclick = () => onAbButton();
}

// ============ AB GUIDANCE (lightbar) ============
let _glRenderKey = null;
let _lastBeepAt = 0;
let _audioCtx = null;

function initLightbar(){
  for (const side of ['lbDotsL', 'lbDotsR']){
    const wrap = document.getElementById(side);
    wrap.innerHTML = '';
    for (let i = 1; i <= GUIDANCE.dots; i++){
      const d = document.createElement('div');
      d.className = 'lb-dot d' + i;
      wrap.appendChild(d);
    }
  }
}

function updateAbBtn(){
  const g = state.guidance;
  const btn = $('#mapAbBtn');
  if (g.active){ btn.textContent = '✕AB'; btn.className = 'iconbtn glass ab setB'; }
  else if (g.a){ btn.textContent = '→B'; btn.className = 'iconbtn glass ab setA'; }
  else { btn.textContent = 'A·B'; btn.className = 'iconbtn glass ab'; }
}

async function onAbButton(){
  const g = state.guidance;
  const f = gps.lastFix;
  if (!g.a){
    navigator.vibrate?.(40);
    if (!f){ toast('Ni GPS pozicije.'); return; }
    g.setA(f);
    state.map.clearGuidance();
    state.map.setAbMarker('A', [f.lat, f.lng]);
    toast('Točka A. Zapelji do konca linije in pritisni →B.', 3500);
  } else if (!g.active){
    if (!f){ toast('Ni GPS pozicije.'); return; }
    if (!g.setB(f)){ toast('Premalo razmika od A (min 5 m).'); return; }
    navigator.vibrate?.([40, 60, 40]);
    g.widthM = effectiveWidthM();
    state.map.setAbMarker('B', [f.lat, f.lng]);
    guidanceEnable();
    saveAbToParcel(g.toJSON());
    toast('AB linija nastavljena.');
  } else {
    if (!await appConfirm('Odstranim AB vodilno linijo?', { okLabel: 'Odstrani', danger: true })) return;
    g.reset();
    guidanceDisable();
    saveAbToParcel(null);
    toast('AB linija odstranjena.');
  }
  updateAbBtn();
}

function guidanceEnable(){
  const g = state.guidance;
  if (state.session) state.session.abLine = g.toJSON();
  _glRenderKey = null; // forsira re-render linij ob naslednjem fixu
  const idx = gps.lastFix ? (g.update(gps.lastFix, null)?.lineIdx ?? 0) : 0;
  state.map.setGuidanceLines(g.getLines(idx, GUIDANCE.linesEachSide), idx);
  if (g.a) state.map.setAbMarker('A', [g.a.lat, g.a.lng]);
  if (g.b) state.map.setAbMarker('B', [g.b.lat, g.b.lng]);
  $('#view-map').classList.add('guidance-on');
}

function guidanceDisable(){
  if (state.session) state.session.abLine = null;
  state.map.clearGuidance();
  $('#view-map').classList.remove('guidance-on');
  _glRenderKey = null;
}

// AB linijo shranimo na izbrano parcelo — naslednja seja na njej jo samodejno naloži.
async function saveAbToParcel(ab){
  const pid = state.session?.parcel?.id || state.selectedParcelId;
  if (!pid) return;
  const p = state.parcels.find(x => x.id === pid);
  if (!p) return;
  p.abLine = ab;
  try { await saveParcel(p); } catch (e){ console.warn(e); }
}

function guidanceOnFix(fix){
  const g = state.guidance;
  if (!g.active) return;
  g.widthM = effectiveWidthM();
  const r = g.update(fix, fix.headingDeg);
  updateLightbar(r);

  // Linije re-rendamo le ob spremembi aktivne linije ali širine
  const key = r.lineIdx + ':' + g.widthM.toFixed(2);
  if (key !== _glRenderKey){
    _glRenderKey = key;
    state.map.setGuidanceLines(g.getLines(r.lineIdx, GUIDANCE.linesEachSide), r.lineIdx);
  }

  const offCm = Math.abs(r.steerM) * 100;
  if (state.settings.guidanceBeep && offCm > GUIDANCE.warnCm &&
      Date.now() - _lastBeepAt > GUIDANCE.beepEveryMs){
    _lastBeepAt = Date.now();
    beep();
    navigator.vibrate?.(150);
  }
}

function updateLightbar(r){
  const offCm = r.steerM * 100; // + = zavij desno
  const absCm = Math.abs(offCm);

  // Številka: pod 1 m v cm, nad tem v m
  if (absCm < 100){
    $('#lbXte').textContent = absCm.toFixed(0);
    $('#lbUnit').textContent = 'cm';
  } else {
    $('#lbXte').textContent = fmtNum(absCm / 100, 1);
    $('#lbUnit').textContent = 'm';
  }
  $('#lbLine').textContent = lineLabel(r.lineIdx) + (r.flipped ? ' ↩' : '');

  // Puščica pove, kam zaviti; barva resnost odklona
  const steerEl = $('#lbSteer');
  if (absCm <= GUIDANCE.okCm){ steerEl.textContent = '●'; steerEl.className = 'lb-steer'; }
  else {
    steerEl.textContent = offCm > 0 ? '→' : '←';
    steerEl.className = 'lb-steer ' + (absCm > GUIDANCE.warnCm ? 'bad' : 'warn');
  }

  // Pike gorijo na strani, kamor moraš zaviti (več pik = večji odklon)
  const litCount = Math.min(GUIDANCE.dots, Math.round(absCm / GUIDANCE.cmPerDot));
  const litSide = offCm > 0 ? 'lbDotsR' : 'lbDotsL';
  for (const side of ['lbDotsL', 'lbDotsR']){
    const dots = document.getElementById(side).children;
    for (let i = 0; i < dots.length; i++){
      dots[i].classList.toggle('on', side === litSide && absCm > GUIDANCE.okCm && i < litCount);
    }
  }
}

// Kratek pisk brez zvočnih datotek (Web Audio)
function beep(){
  try {
    _audioCtx = _audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    const o = _audioCtx.createOscillator();
    const gn = _audioCtx.createGain();
    o.type = 'square';
    o.frequency.value = 880;
    gn.gain.value = 0.12;
    o.connect(gn); gn.connect(_audioCtx.destination);
    o.start();
    o.stop(_audioCtx.currentTime + 0.12);
  } catch (e){ /* zvok ni kritičen */ }
}

// ============ DRAWER (map view side menu) ============
function openDrawer(){
  renderDrawer();
  $('#drawer').classList.add('open');
  $('#drawerScrim').classList.add('open');
}
function closeDrawer(){
  $('#drawer').classList.remove('open');
  $('#drawerScrim').classList.remove('open');
}
function wireDrawer(){
  $('#drawerCloseBtn').onclick = closeDrawer;
  $('#drawerScrim').onclick = closeDrawer;
}

function renderDrawer(){
  const s = state.session;
  const ops = allOperations();
  const op = s ? (ops[s.operation.id] || s.operation) : ops[state.selectedOpId];
  const w = effectiveWidthM();
  $('#drawerOp').textContent = op ? op.name : '—';
  $('#drawerMachine').textContent = s?.machine ? s.machine.name : '—';
  $('#drawerParcel').textContent = s?.parcel ? s.parcel.name : (state.selectedParcelId ? state.parcels.find(p => p.id === state.selectedParcelId)?.name : '—');
  $('#drawerWidth').textContent = fmtNum(w, 1) + ' m';
  $('#drawerGpsSource').textContent = gpsSourceLabel(state.settings.gpsSource);

  // BLE
  const bleOk = ble.connected;
  $('#drawerBleStatus').textContent = bleOk ? (ble.device?.name || 'povezano') : 'ni povezano';
  $('#drawerBleBtn').textContent = bleOk ? 'Prekini' : 'Poveži';
  $('#drawerBleBtn').onclick = () => toggleBle();
  $('#drawerBleBtn').disabled = !ble.isSupported();
  $('#drawerBleUnsupported').style.display = ble.isSupported() ? 'none' : 'block';

  // Sim controls
  $('#drawerSimSpeed').value = state.settings.simSpeedKmh;
  $('#drawerSimSpeedLabel').textContent = state.settings.simSpeedKmh;
  $('#drawerOpacity').value = state.settings.workedOpacity;
  $('#drawerOpacityLabel').textContent = state.settings.workedOpacity.toFixed(2);

  // Ročna preglasitev širine
  $('#drawerWidthOverride').value = state.settings.widthOverride ?? '';

  // GPS source radio
  $$('#drawerGpsRadios input[type=radio]').forEach(r => {
    r.checked = (r.value === state.settings.gpsSource);
  });

  $('#drawerSimSpeed').oninput = e => {
    state.settings.simSpeedKmh = parseFloat(e.target.value);
    $('#drawerSimSpeedLabel').textContent = state.settings.simSpeedKmh.toFixed(0);
    gps.setSimSpeed(state.settings.simSpeedKmh);
    persistSettings();
  };
  $('#drawerOpacity').oninput = e => {
    state.settings.workedOpacity = parseFloat(e.target.value);
    $('#drawerOpacityLabel').textContent = state.settings.workedOpacity.toFixed(2);
    if (state.map) state.map.paintOpacity = state.settings.workedOpacity;
    persistSettings();
  };
  $('#drawerWidthOverride').oninput = e => {
    const v = parseFloat(e.target.value);
    state.settings.widthOverride = (isFinite(v) && v > 0) ? v : null;
    $('#drawerWidth').textContent = fmtNum(effectiveWidthM(), 1) + ' m';
    persistSettings();
  };
  $('#drawerGuideBeep').checked = state.settings.guidanceBeep;
  $('#drawerGuideBeep').onchange = e => {
    state.settings.guidanceBeep = e.target.checked;
    persistSettings();
  };
  $('#drawerDayMode').checked = state.settings.dayTheme;
  $('#drawerDayMode').onchange = e => {
    state.settings.dayTheme = e.target.checked;
    applyTheme();
    persistSettings();
  };
  $$('#drawerGpsRadios input[type=radio]').forEach(r => {
    r.onchange = () => { if (r.checked) setGpsSource(r.value); };
  });
  $('#drawerAreaBtn').onclick = () => { closeDrawer(); startAreaAnalysis(); };
  $('#drawerAddGerkBtn').onclick = async () => {
    closeDrawer();
    await addGerkAtCurrentPosition();
  };
  $('#drawerClearBtn').onclick = async () => {
    if (!state.session) { toast('Ni aktivne seje.'); return; }
    if (!await appConfirm('Počistim trenutno barvanje?', { okLabel: 'Počisti', danger: true })) return;
    if (state.map) state.map.clearCoverage();
    state.session.strips = [];
    state.session.coveredHa = 0;
    state.session.passes = 0;
    updateMapStats();
    toast('Počiščeno');
  };
  $('#drawerGoHome').onclick = async () => {
    if (state.session && state.session.state === 'running'){
      if (!await appConfirm('Seja teče. Odprem Domov (seja ostane aktivna)?', { okLabel: 'Domov' })) return;
    }
    closeDrawer();
    showView('home');
  };
  $('#drawerToHistory').onclick = () => { closeDrawer(); showView('history'); };
  $('#drawerToSettings').onclick = () => { closeDrawer(); showView('settings'); };
}

// Geometrija priključka: {width, latOff, backM, trailed}
// extL/extR: doseg levo/desno od sredine traktorja; backM: delovni center za anteno.
function machineGeometry(){
  const m = state.session?.machine || allMachines().find(x => x.id === state.selectedMachineId);
  if (!m) return { width: effectiveWidthM(), latOff: 0, backM: 0, trailed: false };
  const hasExt = m.extL != null && m.extR != null && (m.extL || m.extR);
  const width = state.settings.widthOverride
    || (hasExt ? (m.extL + m.extR) : effectiveWidthM());
  const latOff = hasExt ? (m.extL - m.extR) / 2 : 0;
  return { width, latOff, backM: m.backM || 0, trailed: !!m.trailed };
}

let _implState = null; // lega vlečnega priključka (tractrix)

function implementPos(fix, geo){
  if (!geo.backM) return null;
  if (geo.trailed){
    _implState = trailedFollow(_implState, { lat: fix.lat, lng: fix.lng }, geo.backM);
    return { ..._implState };
  }
  return offsetBack(fix, fix.headingDeg, geo.backM);
}

function effectiveWidthM(){
  if (state.settings.widthOverride) return state.settings.widthOverride;
  if (state.settings.useBleWidth && state.telemetry.width && state.telemetry.width > 0) return state.telemetry.width;
  if (state.session?.machine) return state.session.machine.width;
  const m = allMachines().find(x => x.id === state.selectedMachineId);
  return m ? m.width : 3.0;
}

function effectiveMachineActive(){
  // Če imamo BLE in uporabnik uporablja BLE active signal:
  if (state.settings.useBleMachineActive && state.telemetry.active != null){
    return state.telemetry.active;
  }
  // Brez signala iz stroja: ročno stikalo DELA/STOJI na karti
  return (state.session ? state.session.state === 'running' : false) && state.manualWork;
}

// ============ SESSION LIFECYCLE ============
async function startSession(){
  if (state.session && state.session.state !== 'stopped'){
    toast('Seja že teče');
    return;
  }
  const op = allOperations()[state.selectedOpId];
  const machine = allMachines().find(m => m.id === state.selectedMachineId);
  let parcel = state.parcels.find(p => p.id === state.selectedParcelId) || null;

  // Ni izbrane parcele, GPS pa je — poglej v GERK knjižnico, kje stojiš
  if (!parcel && gps.lastFix){
    const onKnown = state.parcels.find(p => pointInFeature(gps.lastFix, p.feature));
    if (!onKnown){
      const added = await addGerkAtCurrentPosition({ silent: true });
      if (added) parcel = added;
    }
  }

  state.session = new Session({ operation: op, machine, parcel, note: state.note });
  state.session.start();

  // Najprej pokaži map view, da lahko karta pravilno izračuna velikost
  showView('map');
  ensureMap();

  const finalOpacity = op.fillOpacity * (state.settings.workedOpacity / DEFAULTS.workedOpacity);
  state.map.setPaintStyle(op.color, Math.min(1, Math.max(0.05, finalOpacity)));
  state.map.clearCoverage();

  // "Kje sem že bil": pokritost prejšnjih sej iste operacije na tej parceli (zbledelo)
  state.map.clearPrevCoverage();
  overlapResetAndSeed(null);
  if (parcel){
    savedSessions().then(all => {
      const prev = all.filter(x => x.parcel?.id === parcel.id && x.operation?.id === op.id);
      let strips = prev.flatMap(x => x.strips || []);
      if (strips.length > 8000) strips = strips.slice(-8000); // ponytail: varovalka za render, starejše odrežemo
      if (strips.length){
        state.map.loadPrevCoverage(strips, op.color);
        overlapResetAndSeed(strips); // opozorilo dela tudi čez prejšnje seje
        toast(`Prejšnja pokritost: ${prev.length} sej.`);
      }
    }).catch(()=>{});
  }

  // Naslov na mapi
  $('#mapParcelName').textContent = parcel ? parcel.name : '—';
  $('#mapMachineName').textContent = `${op.name} • ${machine.name} • ${fmtNum(effectiveWidthM(), 1)} m`;

  // Fit na parcelo (po invalidateSize)
  setTimeout(() => {
    if (state.map){
      state.map.resize();
      if (parcel) state.map.fitToParcel(parcel.id);
    }
  }, 60);

  // Če ima parcela bbox in ni zadnjega fixa, postavi sim na centroid
  if (gps.source === 'sim' && !gps.lastFix){
    const c = parcel ? centroidOfFeature(parcel.feature) : { lat: DEFAULTS.center[0], lng: DEFAULTS.center[1] };
    gps.setSimPosition(c);
    state.map.setVehicleLatLng([c.lat, c.lng]);
  }

  // AB linija: nova seja začne s čisto; če jo parcela ima shranjeno, jo naloži
  state.guidance.reset();
  guidanceDisable();
  if (parcel?.abLine && state.guidance.load(parcel.abLine)){
    state.guidance.widthM = effectiveWidthM();
    guidanceEnable();
    toast('AB linija naložena s parcele.');
  }
  updateAbBtn();

  // Prevoz: debelejša črta poti v barvi operacije; sicer tanka bela
  state.map.setDriveStyle(op.noPaint ? 2.8 : 1.6, op.noPaint ? op.color : '#ffffff');
  _implState = null; // reset lege vlečnega priključka
  state.manualWork = true; // nova seja: privzeto "stroj dela"
  setTrackingUI('running');
  refreshTelemetryUI();
  toast('Seja začeta: ' + op.name);
  startAutoSaveTimer();
}

function pauseSession(){
  if (!state.session || state.session.state !== 'running') return;
  state.session.pause();
  setTrackingUI('paused');
  toast('Pavza');
}
function resumeSession(){
  if (!state.session || state.session.state !== 'paused') return;
  state.session.start();
  setTrackingUI('running');
  toast('Nadaljuj');
}
async function confirmStopSession(){
  if (!state.session) { toast('Ni aktivne seje.'); return; }
  if (!await appConfirm('Zaključim in shranim sejo?', { okLabel: 'Shrani' })) return;
  stopSession();
}
async function stopSession(){
  if (!state.session) return;
  state.session.stop();
  setTrackingUI('stopped');
  stopAutoSaveTimer();
  try {
    await state.session.persist();
    toast('Shranjeno: ' + state.session.coveredHa.toFixed(2) + ' ha');
  } catch (e){
    console.warn(e);
    toast('Napaka pri shranjevanju', 3000);
  }
  // Po ustavitvi ne brišemo s karte, dokler uporabnik ne gre na home
  // vendar sprostimo referenco
  // (seja ostane vidna kot pregled)
}

let _autoSaveId = null;
function startAutoSaveTimer(){
  stopAutoSaveTimer();
  _autoSaveId = setInterval(() => {
    if (state.session) state.session.autoSaveIfDue().catch(()=>{});
  }, 3000);
}
function stopAutoSaveTimer(){
  if (_autoSaveId){ clearInterval(_autoSaveId); _autoSaveId = null; }
}

function setTrackingUI(status){
  const badge = $('#trackingBadge');
  if (status === 'running'){
    badge.textContent = 'Aktivno'; badge.className = 'hud-stat on';
    $('#startBtn').disabled = false;
    $('#pauseBtn').disabled = false;
    $('#stopBtn').disabled = false;
    refreshWorkButton(); // glavna tipka postane DELA/STOJI
  } else if (status === 'paused'){
    badge.textContent = 'Pavza'; badge.className = 'hud-stat pause';
    $('#startBtn').textContent = 'Nadaljuj';
    $('#startBtn').className = 'bigbtn primary';
    $('#startBtn').disabled = false;
    $('#pauseBtn').disabled = true;
    $('#stopBtn').disabled = false;
  } else if (status === 'stopped'){
    badge.textContent = 'Končano'; badge.className = 'hud-stat off';
    $('#startBtn').textContent = 'Začni novo';
    $('#startBtn').className = 'bigbtn primary';
    $('#startBtn').disabled = false;
    $('#pauseBtn').disabled = true;
    $('#stopBtn').disabled = true;
  } else {
    badge.textContent = 'Ustavljeno'; badge.className = 'hud-stat off';
    $('#startBtn').textContent = 'Začni';
    $('#startBtn').className = 'bigbtn primary';
    $('#startBtn').disabled = false;
    $('#pauseBtn').disabled = true;
    $('#stopBtn').disabled = true;
  }
}

function wireMapButtons(){
  const start = $('#startBtn'), pause = $('#pauseBtn'), stop = $('#stopBtn');
  pause.textContent = 'Pavza';
  pause.className = 'bigbtn pauseb';
  stop.textContent = 'Shrani';
  stop.className = 'bigbtn stop';
  start.onclick = () => {
    if (!state.session || state.session.state === 'stopped'){ startSession(); return; }
    if (state.session.state === 'paused'){ resumeSession(); return; }
    toggleManualWork(); // med sejo je glavna tipka DELA/STOJI
  };
  pause.onclick = () => pauseSession();
  stop.onclick = () => confirmStopSession();
}

// Glavna tipka med sejo: DELA/STOJI (ročno) oz. stanje iz stroja (BLE)
function toggleManualWork(){
  if (state.settings.useBleMachineActive && state.telemetry.active != null){
    toast('Stanje prihaja iz stroja (BLE).');
    return;
  }
  state.manualWork = !state.manualWork;
  navigator.vibrate?.(40);
  toast(state.manualWork ? 'STROJ DELA — barvanje vklopljeno' : 'STROJ STOJI — samo pot');
  refreshWorkButton();
}

function refreshWorkButton(){
  const btn = $('#startBtn');
  if (!state.session || state.session.state !== 'running') return;
  if (state.session.operation.noPaint){
    btn.textContent = 'PREVOZ';
    btn.className = 'bigbtn work-off';
    return;
  }
  const t = state.telemetry;
  if (state.settings.useBleMachineActive && t.active != null){
    if (t.alarm){ btn.textContent = 'ALARM'; btn.className = 'bigbtn stop'; }
    else if (t.lifted){ btn.textContent = 'DVIGNJEN'; btn.className = 'bigbtn pauseb'; }
    else if (t.active){ btn.textContent = 'DELA'; btn.className = 'bigbtn work-on'; }
    else { btn.textContent = 'MIRUJE'; btn.className = 'bigbtn work-off'; }
  } else {
    btn.textContent = state.manualWork ? 'DELA' : 'STOJI';
    btn.className = 'bigbtn ' + (state.manualWork ? 'work-on' : 'work-off');
  }
}

// ============ GPS FIX HANDLING ============
function onFix(fix){
  if (!state.map) return;
  state.map.setVehicleLatLng([fix.lat, fix.lng]);
  if (fix.headingDeg != null) state.map.setVehicleHeading(fix.headingDeg);
  state.map.softFollow([fix.lat, fix.lng]);

  // Auto-select parcele (ne med urejanjem seje)
  if (state.settings.autoSelectParcel && !state.session && !_editS){
    const hit = state.parcels.find(p => pointInFeature({lat:fix.lat,lng:fix.lng}, p.feature));
    if (hit && hit.id !== state.selectedParcelId){
      state.selectedParcelId = hit.id;
      state.map.highlightParcel(hit.id);
      $('#mapParcelName').textContent = hit.name;
    }
  }

  // Posodobi stats (hitrost, GPS kakovost)
  $('#speedVal').textContent = fmtNum(fix.spdKmh || 0, 1);
  $('#gpsAccuracy').textContent = fix.accuracyM ? '±' + fix.accuracyM.toFixed(0) + 'm' : '—';
  refreshGpsPill(fix);

  // AB vodenje (lightbar)
  guidanceOnFix(fix);

  // predpisna karta: ciljni odmerek cone
  rxOnFix(fix);

  // Če seja teče, dodaj fix v track + morda nariši trak
  if (state.session && state.session.state === 'running'){
    const active = effectiveMachineActive();
    state.map.setVehicleActive(active || !state.session.operation.requiresActive);
    const geo = machineGeometry();
    const widthM = geo.width;
    const flow = state.telemetry.flow ?? null;
    const implPt = implementPos(fix, geo);
    const res = state.session.addFix(fix, active, widthM, flow, implPt, geo.latOff, state.telemetry.fuelLh);
    // obris priključka na karti (koristno predvsem z RTK)
    if (fix.headingDeg != null && (geo.backM || geo.latOff || geo.width !== effectiveWidthM())){
      state.map.setImplementRect(implPt || fix, fix.headingDeg, geo);
    }
    // Tanka črta poti — vedno, tudi ko stroj ne dela (vidiš, kje si se samo vozil)
    if (res.moved && res.moveFrom){
      state.map.paintDrive(res.moveFrom, res.moveTo);
    }
    if (res.painted && res.paintFrom && res.paintTo){
      // intenzivnost = dejanski / nastavljeni odmerek (sejalnica: actualKgHa / setKgHa)
      const setV = state.telemetry.set;
      const intensity = (flow != null && setV > 0) ? flow / setV : null;
      state.map.paintSegment(res.paintFrom, res.paintTo, widthM, intensity);

      // opozorilo na prekrivanje ("tu si že delal")
      if (overlapMarkAndCheck(res.paintFrom, res.paintTo)){
        const nowMs = Date.now();
        if (nowMs - _lastOverlapToastAt > 10000){
          _lastOverlapToastAt = nowMs;
          toast('Prekrivanje — tu si že delal.', 3000);
          if (state.settings.guidanceBeep){ beep(); navigator.vibrate?.(120); }
        }
      }
    }
    updateMapStats();
  } else if (state.session && state.session.state === 'paused'){
    state.map.setVehicleActive(false);
  }
}

function updateMapStats(){
  const s = state.session;
  if (!s) return;
  $('#doneVal').textContent = fmtNum(s.coveredHa, 3);
  $('#passesVal').textContent = String(s.passes);
  $('#widthVal').textContent = fmtNum(effectiveWidthM(), 1);
  if (s.parcel){
    const pct = Math.min(100, Math.round((s.coveredHa / s.parcel.ha) * 100));
    $('#pctVal').textContent = pct + '%';
    const pf = $('#progressFill'); if (pf) pf.style.width = pct + '%';
    // Preostalo + ocena časa iz trenutne hitrosti in širine
    const remainHa = Math.max(0, s.parcel.ha - s.coveredHa);
    $('#remainVal').textContent = fmtNum(remainHa, 2);
    const spd = gps.lastFix?.spdKmh || 0;
    const haPerH = spd * effectiveWidthM() / 10; // km/h * m = 1000 m²/h = 0.1 ha/h
    $('#etaVal').textContent = (remainHa > 0.005 && haPerH > 0.05)
      ? formatDuration(remainHa / haPerH * 3600000)
      : (remainHa <= 0.005 ? '✓' : '—');
  } else {
    $('#pctVal').textContent = '—';
    const pf2 = $('#progressFill'); if (pf2) pf2.style.width = '0%';
    $('#remainVal').textContent = '—';
    $('#etaVal').textContent = '—';
  }
  const durMs = s.activeMsAccum + (s.lastResumeAt ? Date.now() - s.lastResumeAt : 0);
  $('#durVal').textContent = formatDuration(durMs);
}

function refreshGpsPill(fix){
  const pill = $('#gpsPill');
  if (!pill) return;
  let cls = 'ok';
  let label = 'GPS';
  if (!fix) { cls = 'err'; label = 'Brez GPS'; }
  else if (fix.accuracyM && fix.accuracyM > 10) { cls = 'warn'; label = 'GPS ' + fix.accuracyM.toFixed(0) + 'm'; }
  else if (fix.source === 'sim') { cls = 'warn'; label = 'SIM'; }
  else if (fix.source === 'ble') { cls = 'ok'; label = 'RTK/ESP'; }
  else label = 'GPS ±' + (fix.accuracyM?.toFixed(0) || '?') + 'm';
  pill.className = 'hud-stat ' + cls;
  pill.textContent = label;
}

function refreshBlePill(){
  const pill = $('#blePill');
  if (!pill) return;
  if (ble.connected){
    pill.className = 'hud-stat ok';
    pill.textContent = 'BLE';
  } else {
    pill.className = 'hud-stat off';
    pill.textContent = 'Brez stroja';
  }
}

function refreshOnlinePill(){
  const pill = $('#onlinePill');
  if (!pill) return;
  if (state.online){
    pill.className = 'hud-stat ok';
    pill.textContent = 'Online';
  } else {
    pill.className = 'hud-stat warn';
    pill.textContent = 'Offline';
  }
}

function refreshTelemetryUI(){
  // Če je BLE povezan in pošilja active, posodobi vozilo
  if (state.map && state.session){
    const active = effectiveMachineActive();
    state.map.setVehicleActive(active || !state.session.operation.requiresActive);
  }
  // Posodobi širino v label-u
  $('#widthVal') && ($('#widthVal').textContent = fmtNum(machineGeometry().width, 1));
  // Drawer widths
  if (document.getElementById('drawerWidth')){
    document.getElementById('drawerWidth').textContent = fmtNum(effectiveWidthM(), 1) + ' m';
  }
  // Flow
  if ($('#flowVal') && state.telemetry.flow != null){
    $('#flowVal').textContent = fmtNum(state.telemetry.flow, 1);
  }
  refreshWorkButton();
  const rpmEl = $('#rpmVal');
  if (rpmEl) rpmEl.textContent = state.telemetry.rpm != null ? fmtNum(state.telemetry.rpm, 0) : '—';
  const flh = $('#fuelLhVal');
  if (flh) flh.textContent = state.telemetry.fuelLh != null ? fmtNum(state.telemetry.fuelLh, 1) + ' l/h' : '—';
  // Status stroja (sejalnica preko BLE): ALARM > DVIGNJEN > SEJE > MIRUJE
  const ms = $('#machineState');
  if (ms){
    const t = state.telemetry;
    if (!ble.connected || !t.rs485ok){
      // ročni način: stikalo DELA/STOJI (tap na ploščico)
      if (state.session && state.session.state === 'running' && !state.session.operation.noPaint){
        ms.textContent = state.manualWork ? 'DELA' : 'STOJI';
        ms.style.color = state.manualWork ? 'var(--ok)' : 'var(--muted)';
      } else {
        ms.textContent = '—'; ms.style.color = '';
      }
    } else if (t.alarm){
      ms.textContent = 'ALARM'; ms.style.color = 'var(--danger)';
    } else if (t.lifted){
      ms.textContent = 'DVIGNJEN'; ms.style.color = 'var(--warn)';
    } else if (t.active){
      ms.textContent = 'SEJE'; ms.style.color = 'var(--ok)';
    } else {
      ms.textContent = 'MIRUJE'; ms.style.color = '';
    }
  }
}

// ============ BLE / GPS SOURCE ============
async function toggleBle(){
  if (ble.connected){
    await ble.disconnect();
    return;
  }
  try {
    toast('Iskanje ESP32 modula…');
    const r = await ble.connect();
    toast('Povezano: ' + r.name);
    // Po povezavi ponudi, da preklopiš GPS vir na BLE
    if (state.settings.gpsSource !== 'ble'){
      setTimeout(async () => {
        if (await appConfirm('Uporabim GPS iz ESP32 modula?', { okLabel: 'Uporabi' })){
          setGpsSource('ble');
        }
      }, 300);
    }
  } catch (e){
    toast('BLE neuspešno: ' + (e.message || e), 3500);
    console.warn(e);
  }
}

function setGpsSource(src){
  state.settings.gpsSource = src;
  gps.setSource(src);
  persistSettings();
  if (document.getElementById('drawerGpsSource')){
    document.getElementById('drawerGpsSource').textContent = gpsSourceLabel(src);
  }
  toast('GPS vir: ' + gpsSourceLabel(src));
}

function gpsSourceLabel(src){
  return { phone: 'Telefon', ble: 'ESP32 (BLE)', sim: 'Simulacija' }[src] || src;
}

// ============ UREDNIK OPERACIJ IN STROJEV ============

function renderOpsList(){
  const el = $('#settingsOpsList');
  if (!el) return;
  const ops = state.settings.customOps || [];
  el.innerHTML = ops.length ? ops.map((o, i) => `
    <div class="rowline">
      <span><span style="display:inline-block;width:10px;height:10px;border-radius:2px;background:${o.color};margin-right:6px"></span>${escapeHtml(o.name)} <span class="small muted">${o.unit || ''}${o.noPaint ? ' · samo pot' : ''}</span></span>
      <button class="minibtn danger" data-i="${i}" style="padding:6px 10px">Izbriši</button>
    </div>`).join('') : '<div class="small muted">Ni dodatnih operacij.</div>';
  el.querySelectorAll('button[data-i]').forEach(b => {
    b.onclick = async () => {
      const i = +b.dataset.i;
      if (!await appConfirm(`Izbrišem operacijo "${ops[i].name}"?`, { okLabel: 'Izbriši', danger: true })) return;
      ops.splice(i, 1);
      await persistSettings();
      renderOpsList(); renderHome();
    };
  });
}

async function editOperation(id){
  const op = allOperations()[id];
  if (!op) return;
  const f = await appForm('Operacija: ' + op.name, [
    { key: 'name', label: 'Ime', type: 'text', value: op.name },
    { key: 'valueUnit', label: 'Enota vrednosti (npr. kg/ha)', type: 'text', value: op.valueUnit || '' },
    { key: 'requiresActive', label: 'Barvaj samo, ko stroj javi "aktiven" (BLE)', type: 'check', value: !!op.requiresActive },
    { key: 'noPaint', label: 'Samo pot (brez barvanja)', type: 'check', value: !!op.noPaint }
  ]);
  if (!f) return;
  const custom = (state.settings.customOps || []).find(o => o.id === id);
  if (custom){
    custom.name = f.name || custom.name;
    custom.unit = f.valueUnit;
    custom.requiresActive = f.requiresActive;
    custom.noPaint = f.noPaint;
  } else {
    state.settings.opParams = state.settings.opParams || {};
    state.settings.opParams[id] = {
      name: f.name || op.name, valueUnit: f.valueUnit, valueLabel: f.name || op.name,
      requiresActive: f.requiresActive, noPaint: f.noPaint
    };
  }
  await persistSettings();
  renderHome();
  toast('Shranjeno: ' + (f.name || op.name));
}

function showParcelOnMap(id){
  const p = state.parcels.find(x => x.id === id);
  if (!p) return;
  state.selectedParcelId = id;
  ensureMap();
  showView('map');
  state.map.setFollow(false);
  state.map.highlightParcel(id);
  state.map.fitToParcel(id);
  $('#mapParcelName').textContent = p.name;
  $('#mapMachineName').textContent = fmtNum(p.ha, 2) + ' ha' + (p.gerkPid ? ' · GERK ' + p.gerkPid : '');
}

async function addCustomOp(){
  const f = await appForm('Nova operacija', [
    { key: 'name', label: 'Ime (npr. Mulčenje)', type: 'text', value: '' },
    { key: 'unit', label: 'Enota vrednosti (npr. kg/ha, l/ha — lahko prazno)', type: 'text', value: '' },
    { key: 'requiresActive', label: 'Barvaj samo, ko stroj javi "aktiven" (BLE)', type: 'check', value: false },
    { key: 'noPaint', label: 'Samo pot (brez barvanja — kot Prevoz)', type: 'check', value: false }
  ], 'Dodaj');
  if (!f || !f.name) return;
  state.settings.customOps = state.settings.customOps || [];
  const used = state.settings.customOps.length;
  state.settings.customOps.push({
    id: 'cust_' + newId('op'),
    name: f.name, unit: f.unit,
    color: OP_COLORS[used % OP_COLORS.length],
    requiresActive: f.requiresActive, noPaint: f.noPaint
  });
  await persistSettings();
  renderOpsList(); renderHome();
  toast('Operacija dodana: ' + f.name);
}

function renderMachinesList(){
  const el = $('#settingsMachinesList');
  if (!el) return;
  el.innerHTML = allMachines().map(mch => `
    <div class="rowline">
      <span style="cursor:pointer" data-stat="${mch.id}"><strong>${escapeHtml(mch.name)}</strong> <span class="small muted">${fmtNum(mch.width, 1)} m${mch.cph ? ' · ' + fmtNum(mch.cph, 0) + ' €/h' : ''}</span></span>
      <button class="minibtn" data-edit="${mch.id}" style="padding:6px 10px">Uredi</button>
    </div>`).join('');
  el.querySelectorAll('[data-stat]').forEach(s => {
    s.onclick = () => showMachineStats(s.dataset.stat);
  });
  el.querySelectorAll('button[data-edit]').forEach(b => {
    b.onclick = () => editMachine(b.dataset.edit);
  });
}

// Predogled geometrije: pogled od zgoraj — traktor + priključek
function machinePreviewSvg(v){
  const extL = +v.extL || 0, extR = +v.extR || 0, back = +v.backM || 0;
  const w = Math.max(extL + extR, 2), span = Math.max(extL, extR, 2);
  const sc = 120 / Math.max(span * 2, 4);          // px na meter
  const cx = 150, cy0 = 34;
  const iy = cy0 + 26 + back * sc * 0.55;
  const x1 = cx - extR * sc, x2 = cx + extL * sc;  // levo od smeri = desno na ekranu gledano od zadaj? prikaz: levo stroja = levo na ekranu
  return `<svg viewBox="0 0 300 ${Math.max(120, iy + 26)}" style="width:100%;background:var(--sunken);border-radius:8px">
    <rect x="${cx-16}" y="${cy0-24}" width="32" height="44" rx="6" fill="none" stroke="#86efac" stroke-width="2"/>
    <circle cx="${cx}" cy="${cy0-4}" r="3" fill="#f59e0b"/>
    <line x1="${cx}" y1="${cy0+20}" x2="${cx}" y2="${iy-9}" stroke="#94a3b8" stroke-width="2" ${v.trailed ? 'stroke-dasharray="4,4"' : ''}/>
    <rect x="${Math.min(x1,x2)}" y="${iy-9}" width="${Math.abs(x2-x1) || 4}" height="18" rx="4" fill="rgba(34,197,94,.25)" stroke="#22c55e" stroke-width="2"/>
    <line x1="${cx}" y1="${cy0-30}" x2="${cx}" y2="${iy+18}" stroke="rgba(255,255,255,.25)" stroke-width="1" stroke-dasharray="2,4"/>
    <text x="${x2+4}" y="${iy+4}" fill="#93a498" font-size="10">${(extL||0).toFixed(1)} m levo</text>
    <text x="${x1-4}" y="${iy+4}" fill="#93a498" font-size="10" text-anchor="end">${(extR||0).toFixed(1)} m desno</text>
    <text x="${cx+6}" y="${(cy0+iy)/2}" fill="#93a498" font-size="10">${(back||0).toFixed(1)} m nazaj${v.trailed ? ' (vlečen)' : ''}</text>
  </svg>`;
}

async function editMachine(id){
  const mch = allMachines().find(x => x.id === id);
  if (!mch) return;
  const opOptions = [{ v: '', l: '— brez —' }].concat(
    Object.values(allOperations()).map(o => ({ v: o.id, l: o.name })));
  const f = await appForm('Stroj: ' + mch.name, [
    { key: 'name', label: 'Ime', type: 'text', value: mch.name },
    { key: 'defaultOp', label: 'Privzeti tip dela (ob izbiri stroja)', type: 'select',
      options: opOptions, value: mch.defaultOp || '' },
    { key: 'width', label: 'Delovna širina (m) — če je stroj sredinski', type: 'number', step: '0.1', value: mch.width },
    { key: 'extL', label: 'Doseg LEVO od sredine (m) — za asimetrične', type: 'number', step: '0.1', value: mch.extL ?? '' },
    { key: 'extR', label: 'Doseg DESNO od sredine (m)', type: 'number', step: '0.1', value: mch.extR ?? '' },
    { key: 'backM', label: 'Delovni center ZA anteno/traktorjem (m)', type: 'number', step: '0.1', value: mch.backM ?? '' },
    { key: 'trailed', label: 'Vlečen (za traktorjem, ne fiksen na hidravliki)', type: 'check', value: !!mch.trailed },
    { key: 'cph', label: 'Lastna cena (€/h) — amortizacija, vzdrževanje', type: 'number', step: '0.5', value: mch.cph ?? '' },
    { key: 'lph', label: 'Poraba goriva (l/h)', type: 'number', step: '0.5', value: mch.lph ?? '' },
    { key: 'fuel', label: 'Cena goriva (€/l)', type: 'number', step: '0.01', value: mch.fuel ?? '' },
    { key: 'spha', label: 'Storitvena cena (€/ha) — kar bi zaračunal', type: 'number', step: '1', value: mch.spha ?? '' }
  ], 'Shrani', machinePreviewSvg);
  if (!f) return;
  const patch = { name: f.name || mch.name, width: f.width || mch.width,
                  defaultOp: f.defaultOp || null,
                  extL: f.extL, extR: f.extR, backM: f.backM, trailed: f.trailed,
                  cph: f.cph, lph: f.lph, fuel: f.fuel, spha: f.spha };
  const customs = state.settings.customMachines || [];
  const ci = customs.findIndex(x => x.id === id);
  if (ci >= 0) Object.assign(customs[ci], patch);
  else {
    state.settings.machineParams = state.settings.machineParams || {};
    state.settings.machineParams[id] = { ...(state.settings.machineParams[id] || {}), ...patch };
  }
  await persistSettings();
  renderMachinesList(); renderHome();
  toast('Shranjeno: ' + patch.name);
}

async function addCustomMachine(){
  const f = await appForm('Nov stroj / vozilo', [
    { key: 'name', label: 'Ime (npr. Mulčer, Avto)', type: 'text', value: '' },
    { key: 'width', label: 'Delovna širina (m; za vozila pusti 0)', type: 'number', step: '0.1', value: 2.0 }
  ], 'Dodaj');
  if (!f || !f.name) return;
  state.settings.customMachines = state.settings.customMachines || [];
  state.settings.customMachines.push({ id: 'custm_' + newId('m'), name: f.name, width: f.width || 0, tag: '' });
  await persistSettings();
  renderMachinesList(); renderHome();
  toast('Dodan: ' + f.name);
}

// Statistika stroja iz vseh sej: ure, efektivne ure, ha, km, hitrost, stroški
async function showMachineStats(id){
  const mch = allMachines().find(x => x.id === id);
  if (!mch) return;
  const all = await savedSessions();
  const mine = all.filter(s => s.machine?.id === id);
  let ms = 0, effMs = 0, ha = 0, km = 0, effKm = 0;
  for (const s of mine){
    ms += s.durationMs || 0;
    ha += s.coveredHa || 0;
    km += (s.distanceM || 0) / 1000;
    effKm += (s.activeDistanceM || 0) / 1000;
    // efektivni čas: seštej dt med zaporednima aktivnima točkama tracka
    const tr = s.track || [];
    for (let i = 1; i < tr.length; i++){
      if (tr[i].active && tr[i-1].active){
        const dt = tr[i].t - tr[i-1].t;
        if (dt > 0 && dt < 10000) effMs += dt;
      }
    }
  }
  const h = ms / 3600000, effH = effMs / 3600000;
  const avgKmh = effH > 0.02 ? effKm / effH : 0;
  const haPerH = effH > 0.02 ? ha / effH : 0;
  const realFuel = mine.reduce((acc, s) => acc + (s.fuelL || 0), 0);
  const fuelL = realFuel > 0 ? realFuel : (mch.lph ? h * mch.lph : 0);
  const cost = (mch.cph ? h * mch.cph : 0) + (fuelL && mch.fuel ? fuelL * mch.fuel : 0);
  const value = mch.spha ? ha * mch.spha : 0;
  const row = (l, v) => `<div class="rowline"><span class="small muted">${l}</span><strong>${v}</strong></div>`;
  const body = $('#modalBody');
  body.innerHTML = `
    <div style="font-weight:800;font-size:15px;margin-bottom:8px">${escapeHtml(mch.name)} — statistika</div>
    ${row('Sej', mine.length)}
    ${row('Ure (skupaj)', fmtNum(h, 1) + ' h')}
    ${row('Efektivne ure (delo)', fmtNum(effH, 1) + ' h')}
    ${row('Obdelano', fmtNum(ha, 2) + ' ha')}
    ${row('Prevoženo', fmtNum(km, 1) + ' km')}
    ${row('Povp. delovna hitrost', fmtNum(avgKmh, 1) + ' km/h')}
    ${row('Storilnost', fmtNum(haPerH, 2) + ' ha/h')}
    ${fuelL ? row(realFuel > 0 ? 'Gorivo (CAN, realno)' : 'Gorivo (ocena)', fmtNum(fuelL, 0) + ' l' + (mch.fuel ? ' = ' + fmtNum(fuelL * mch.fuel, 0) + ' €' : '')) : ''}
    ${cost ? row('Lastni strošek (ocena)', fmtNum(cost, 0) + ' €') : ''}
    ${ha > 0 && cost ? row('Strošek na ha', fmtNum(cost / ha, 1) + ' €/ha') : ''}
    ${value ? row('Storitvena vrednost', fmtNum(value, 0) + ' €') : ''}
    <div class="hint" style="margin-top:8px">Iz GPS sej. Poraba/odmerek iz stroja (BLE) in ISOBUS podatki pridejo v prihodnjih verzijah.</div>`;
  $('#modalScrim').classList.add('open');
}

async function persistSettings(){
  try { await setKV('settings', state.settings); } catch {}
}

// ============ HISTORY VIEW ============
let _historyParcelFilter = '';

async function renderHistory(){
  const list = $('#historyList');
  let sessions = await savedSessions();

  // Filter po parceli + povzetek
  const sel = $('#historyParcelFilter');
  const parcelIds = [...new Map(sessions.filter(s => s.parcel).map(s => [s.parcel.id, s.parcel.name])).entries()];
  sel.innerHTML = '<option value="">Vse parcele</option>' +
    parcelIds.map(([id, name]) => `<option value="${id}" ${id === _historyParcelFilter ? 'selected' : ''}>${escapeHtml(name)}</option>`).join('');
  sel.onchange = () => { _historyParcelFilter = sel.value; renderHistory(); };

  if (_historyParcelFilter) sessions = sessions.filter(s => s.parcel?.id === _historyParcelFilter);

  const sumHa = sessions.reduce((a, s) => a + (s.coveredHa || 0), 0);
  const sumMs = sessions.reduce((a, s) => a + (s.durationMs || 0), 0);
  $('#historySummary').textContent = sessions.length
    ? `${sessions.length} sej • ${fmtNum(sumHa, 1)} ha • ${formatDuration(sumMs)}`
    : '—';
  const pb = $('#historyParcelExportBtn');
  if (pb){
    pb.style.display = _historyParcelFilter ? '' : 'none';
    pb.onclick = () => exportParcelReport(_historyParcelFilter);
  }

  if (!sessions.length){
    list.innerHTML = `
      <div class="empty-state">
        <div class="icon">📂</div>
        <div>Ni shranjenih sej.</div>
        <div class="small" style="margin-top:6px">Začni delo, pa se bo pojavilo tukaj.</div>
      </div>`;
    return;
  }
  list.innerHTML = sessions.map(s => {
    const op = s.operation || {};
    const dur = formatDuration(s.durationMs || 0);
    const dist = formatDistance(s.distanceM || 0);
    return `
      <div class="session-card" data-id="${s.id}">
        <div class="session-top">
          <div class="session-icon" style="background:${op.color || '#22c55e'}22;color:${op.color || '#22c55e'}">${svgIcon(opSvg(op.id))}</div>
          <div class="session-info">
            <div class="session-title">${escapeHtml(op.name || 'Opravilo')} • ${escapeHtml(s.machine?.name || '')}</div>
            <div class="session-date">${fmtTs(s.startedAt)}${s.parcel ? ' • ' + escapeHtml(s.parcel.name) : ''}</div>
          </div>
        </div>
        <div class="session-metrics">
          <div class="session-metric"><div class="v">${fmtNum(s.coveredHa || 0, 2)}</div><div class="l">ha</div></div>
          <div class="session-metric"><div class="v">${dist}</div><div class="l">pot</div></div>
          <div class="session-metric"><div class="v">${dur}</div><div class="l">čas</div></div>
          <div class="session-metric"><div class="v">${s.passes || 0}</div><div class="l">preh.</div></div>
        </div>
      </div>
    `;
  }).join('');
  list.querySelectorAll('.session-card').forEach(c => {
    c.onclick = () => openSessionDetail(c.dataset.id);
  });
}

function wireHistoryView(){
  $('#historyBackBtn').onclick = () => showView('home');
  $('#historyExportAllBtn').onclick = () => exportAllSessionsAsGeoJSON();
}

async function openSessionDetail(id){
  const s = await getSession(id);
  if (!s) return;
  const body = $('#modalBody');
  const op = s.operation || {};
  const dur = formatDuration(s.durationMs || 0);
  const flowText = s.flowTotal != null ? s.flowTotal.toFixed(1) + ' ' + (op.unit || '') : '—';
  body.innerHTML = `
    <div style="display:flex;align-items:center;gap:10px;margin-bottom:12px">
      <div class="session-icon" style="background:${op.color || '#22c55e'}22;color:${op.color || '#22c55e'};width:52px;height:52px">${svgIcon(opSvg(op.id), 'icon lg')}</div>
      <div>
        <div style="font-weight:800">${escapeHtml(op.name || '—')}</div>
        <div class="small muted">${fmtTs(s.startedAt)}${s.endedAt ? ' – ' + new Date(s.endedAt).toLocaleTimeString('sl-SI', {hour:'2-digit', minute:'2-digit'}) : ''}</div>
      </div>
    </div>
    <div class="session-metrics" style="grid-template-columns:repeat(2,1fr)">
      <div class="session-metric"><div class="v">${fmtNum(s.coveredHa || 0, 3)}</div><div class="l">ha</div></div>
      <div class="session-metric"><div class="v">${formatDistance(s.distanceM || 0)}</div><div class="l">pot</div></div>
      <div class="session-metric"><div class="v">${dur}</div><div class="l">čas</div></div>
      <div class="session-metric"><div class="v">${s.passes || 0}</div><div class="l">preh.</div></div>
      <div class="session-metric"><div class="v">${s.machine?.name || '—'}</div><div class="l">stroj</div></div>
      <div class="session-metric"><div class="v">${s.parcel?.name || '—'}</div><div class="l">parcela</div></div>
      ${s.parcel?.gerkPid ? `<div class="session-metric"><div class="v">${s.parcel.gerkPid}</div><div class="l">GERK</div></div>` : ''}
    </div>
    ${s.note ? `<div class="card" style="margin-top:10px"><div class="small muted">Opomba</div><div style="margin-top:4px">${escapeHtml(s.note)}</div></div>` : ''}
    <div class="btn-row" style="margin-top:12px">
      <button class="minibtn" id="modalShowBtn">Prikaži na karti</button>
      <button class="minibtn" id="modalEditBtn">Uredi (briši trakove)</button>
      <button class="minibtn" id="modalExportBtn">Izvozi GeoJSON</button>
      <button class="minibtn danger" id="modalDeleteBtn">Izbriši sejo</button>
    </div>
  `;
  $('#modalScrim').classList.add('open');
  $('#modalShowBtn').onclick = () => openSessionOnMap(s.id, false);
  $('#modalEditBtn').onclick = () => openSessionOnMap(s.id, true);
  $('#modalExportBtn').onclick = () => exportSessionAsGeoJSON(s);
  $('#modalDeleteBtn').onclick = async () => {
    if (!await appConfirm('Izbrišem sejo? Tega ni mogoče razveljaviti.', { okLabel: 'Izbriši', danger: true })) return;
    await deleteSession(s.id);
    closeModal();
    renderHistory();
    toast('Izbrisano');
  };
}
function closeModal(){ $('#modalScrim').classList.remove('open'); }

function exportSessionAsGeoJSON(s){
  const fc = sessionToGeoJSON(s);
  const blob = new Blob([JSON.stringify(fc, null, 2)], { type: 'application/geo+json' });
  downloadBlob(blob, `seja-${s.id}.geojson`);
}

async function exportAllSessionsAsGeoJSON(){
  const all = await savedSessions();
  if (!all.length){ toast('Ni sej'); return; }
  const features = [];
  for (const s of all){
    const fc = sessionToGeoJSON(s);
    for (const f of fc.features) features.push(f);
  }
  const blob = new Blob([JSON.stringify({ type: 'FeatureCollection', features }, null, 2)], { type: 'application/geo+json' });
  downloadBlob(blob, `agrotracker-seje-${Date.now()}.geojson`);
  toast('Izvoženo ' + all.length + ' sej');
}

// CSV evidenca vseh sej — za preglednice, poročila, precizno kmetijstvo
async function exportSessionsCSV(){
  const all = await savedSessions();
  if (!all.length){ toast('Ni sej'); return; }
  const esc = (v) => {
    const s = String(v ?? '');
    return /[;"\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  const rows = [[
    'datum', 'zacetek', 'konec', 'trajanje_min', 'operacija', 'stroj', 'sirina_m',
    'parcela', 'gerk_pid', 'raba', 'parcela_ha', 'obdelano_ha', 'razdalja_km', 'prehodi', 'poraba_skupaj', 'enota', 'opomba'
  ]];
  for (const s of all){
    const d = new Date(s.startedAt);
    rows.push([
      d.toLocaleDateString('sl-SI'),
      d.toLocaleTimeString('sl-SI', { hour: '2-digit', minute: '2-digit' }),
      s.endedAt ? new Date(s.endedAt).toLocaleTimeString('sl-SI', { hour: '2-digit', minute: '2-digit' }) : '',
      ((s.durationMs || 0) / 60000).toFixed(0),
      s.operation?.name || '',
      s.machine?.name || '',
      s.machine?.width ?? '',
      s.parcel?.name || '',
      s.parcel?.gerkPid ?? '',
      s.parcel?.raba ?? '',
      s.parcel?.ha != null ? s.parcel.ha.toFixed(2) : '',
      (s.coveredHa || 0).toFixed(3),
      ((s.distanceM || 0) / 1000).toFixed(2),
      s.passes || 0,
      s.flowTotal != null ? s.flowTotal.toFixed(1) : '',
      s.operation?.unit || '',
      s.note || ''
    ]);
  }
  // ponytail: podpičje kot ločilo — slovenski Excel ga pričakuje
  const csv = '﻿' + rows.map(r => r.map(esc).join(';')).join('\r\n');
  downloadBlob(new Blob([csv], { type: 'text/csv;charset=utf-8' }), `agrotracker-evidenca-${new Date().toISOString().slice(0,10)}.csv`);
  toast('CSV izvožen: ' + all.length + ' sej');
}

function sessionToGeoJSON(s){
  const features = [];
  // Track kot LineString
  if (s.track && s.track.length > 1){
    features.push({
      type: 'Feature',
      properties: {
        kind: 'track',
        sessionId: s.id,
        operation: s.operation?.name,
        operationId: s.operation?.id,
        machine: s.machine?.name,
        startedAt: new Date(s.startedAt).toISOString(),
        coveredHa: s.coveredHa,
        distanceM: s.distanceM,
        gerkPid: s.parcel?.gerkPid ?? null,
        kmgMid: s.parcel?.feature?.properties?.KMG_MID ?? null,
        flowTotal: s.flowTotal ?? null,
        flowUnit: s.operation?.unit || null,
        note: s.note || null,
        color: s.operation?.color
      },
      geometry: { type: 'LineString', coordinates: s.track.map(p => [p.lng, p.lat]) }
    });
  }
  // Vsak strip kot Polygon
  (s.strips || []).forEach((strip, i) => {
    features.push({
      type: 'Feature',
      properties: { kind: 'coverage', sessionId: s.id, idx: i, operation: s.operation?.name,
        gerkPid: s.parcel?.gerkPid ?? null, color: s.operation?.color },
      geometry: { type: 'Polygon', coordinates: [ strip.map(p => [p[1], p[0]]).concat([[strip[0][1], strip[0][0]]]) ] }
    });
  });
  // Parcela
  if (s.parcel?.feature){
    features.push({
      type: 'Feature',
      properties: { kind: 'parcel', sessionId: s.id, name: s.parcel.name, ha: s.parcel.ha },
      geometry: s.parcel.feature.geometry
    });
  }
  return { type: 'FeatureCollection', features };
}

function downloadBlob(blob, name){
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name; document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 100);
}

// ============ SETTINGS VIEW ============
function wireSettingsView(){
  $('#settingsBackBtn').onclick = () => showView('home');
  $('#settingsImportBtn').onclick = () => $('#fileImport').click();

  // KMG-MID (shrani se ob vnosu)
  $('#settingsKmgMid').value = state.settings.kmgMid || '';
  $('#settingsKmgMid').addEventListener('change', (e) => {
    state.settings.kmgMid = e.target.value.trim();
    persistSettings();
  });

  // Uvoz GERK območja: knjižnica + samodejni vnos mojih parcel po KMG-MID
  $('#settingsImportGerkBtn').onclick = () => {
    if (!(state.settings.kmgMid || '').trim()){
      appInfo('Najprej vpiši svoj KMG-MID — po njem app iz datoteke prepozna tvoje parcele.', 'KMG-MID manjka');
      return;
    }
    $('#fileImportGerk').click();
  };
  $('#fileImportGerk').addEventListener('change', async (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    try {
      const r = await importGerkArea(f);
      state.parcels = await savedParcels();
      renderSettings();
      await appInfo(`Knjižnica: ${r.lib} GERK-ov. Samodejno dodanih tvojih parcel (KMG-MID ${r.mid}): ${r.added}.`, 'GERK uvoz uspel');
    } catch (err){
      console.warn(err);
      appInfo('Uvoz ni uspel: ' + (err.message || err), 'Napaka');
    }
    e.target.value = '';
  });
  // "Sam prenesi in uvozi": datoteko zgradi GitHub Action (gerk-data.yml)
  // iz KMG-MID v tools/gerk_config.json in jo objavi na Pages — isti origin, brez CORS.
  $('#settingsFetchGerkBtn').onclick = async () => {
    const mid = (state.settings.kmgMid || '').trim();
    if (!mid){
      appInfo('Najprej vpiši svoj KMG-MID.', 'KMG-MID manjka');
      return;
    }
    toast('Prenašam GERK podatke…', 4000);
    try {
      const r = await fetch('./data/gerk-obmocje.geojson?v=' + Date.now(), { cache: 'reload' });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const gj = await r.json();
      const res = await importGerkData(gj);
      state.parcels = await savedParcels();
      renderSettings();
      if (!res.added && res.mid){
        await appInfo(`Knjižnica posodobljena (${res.lib} GERK-ov), a nobeden nima KMG-MID ${res.mid} — preveri, ali je v tools/gerk_config.json na GitHubu isti MID.`, 'Ni tvojih parcel');
      } else {
        await appInfo(`Knjižnica: ${res.lib} GERK-ov. Tvojih parcel dodanih: ${res.added}.`, 'GERK prenos uspel');
      }
    } catch (e){
      await appInfo('Podatkovna datoteka še ni objavljena. Enkratna nastavitev: na GitHubu vpiši svoj KMG-MID v tools/gerk_config.json (Action potem vse naredi sam) — ali pa MID sporoči meni.', 'Ni podatkov');
    }
  };

  $('#settingsClearGerkLibBtn').onclick = async () => {
    if (!await appConfirm('Izbrišem GERK knjižnico območja? (Parcele ostanejo.)', { okLabel: 'Izbriši', danger: true })) return;
    await clearGerkLib();
    state.gerkLib = { type: 'FeatureCollection', features: [] };
    renderSettings();
    toast('Knjižnica izbrisana');
  };
  $('#fileImport').addEventListener('change', async (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    try {
      const text = await f.text();
      const gj = JSON.parse(text);
      await importGeoJSON(gj);
      toast('Uvoz uspel');
      state.parcels = await savedParcels();
      renderSettings();
    } catch (err){
      toast('Napaka uvoza: ' + err.message, 4000);
    }
    e.target.value = '';
  });
  $('#settingsClearParcelsBtn').onclick = async () => {
    if (!await appConfirm('Izbrišem vse parcele?', { okLabel: 'Izbriši', danger: true })) return;
    await clearParcels();
    state.parcels = [];
    toast('Izbrisano');
    renderSettings();
  };
  $('#settingsResetSettingsBtn').onclick = async () => {
    if (!await appConfirm('Resetiram nastavitve na privzete?', { okLabel: 'Resetiraj', danger: true })) return;
    await setKV('settings', null);
    location.reload();
  };
  $('#settingsBleBtn').onclick = () => toggleBle();

  // GPS vir
  $$('input[name=settingsGpsSrc]').forEach(r => {
    r.onchange = () => { if (r.checked) setGpsSource(r.value); };
  });

  // Auto parcel toggle
  $('#settingsAutoParcel').addEventListener('change', (e) => {
    state.settings.autoSelectParcel = e.target.checked;
    persistSettings();
  });
  $('#settingsDayMode').addEventListener('change', (e) => {
    state.settings.dayTheme = e.target.checked;
    applyTheme();
    persistSettings();
  });
  $('#settingsUseBleActive').addEventListener('change', (e) => {
    state.settings.useBleMachineActive = e.target.checked;
    persistSettings();
  });
  $('#settingsUseBleWidth').addEventListener('change', (e) => {
    state.settings.useBleWidth = e.target.checked;
    persistSettings();
  });

  // Offline tiles
  $('#settingsPrewarmBtn').onclick = () => prewarmTilesForParcels();
  $('#settingsClearTilesBtn').onclick = async () => {
    if (!await appConfirm('Izbrišem vse predprenesene tile-e? Karta bo brez interneta nedostopna.', { okLabel: 'Izbriši', danger: true })) return;
    await clearTileCache();
    toast('Tile cache izbrisan');
    renderSettings();
  };
  $('#settingsExportAllBtn').onclick = () => exportAllSessionsAsGeoJSON();
  $('#settingsAddOpBtn').onclick = () => addCustomOp();
  $('#settingsImportLayerBtn').onclick = () => $('#fileImportLayer').click();
  $('#fileImportLayer').addEventListener('change', async (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    try {
      const layer = await importLayerFile(f);
      if (layer){
        state.settings.activeLayerId = layer.id;
        await persistSettings();
        activateLayer(layer.id);
        renderLayersList();
        toast('Sloj uvožen: ' + layer.name);
      }
    } catch (err){ appInfo('Uvoz sloja ni uspel: ' + (err.message || err), 'Napaka'); }
    e.target.value = '';
  });
  $('#settingsAddMachineBtn').onclick = () => addCustomMachine();
  $('#settingsExportCsvBtn').onclick = () => exportSessionsCSV();

  // Modal close
  $('#modalCloseBtn').onclick = closeModal;
  $('#modalScrim').addEventListener('click', (e) => { if (e.target.id === 'modalScrim') closeModal(); });
}

async function prewarmTilesForParcels(){
  if (!state.parcels.length){ toast('Ni parcel za predprenos'); return; }
  if (state.tileDownload && !state.tileDownload.finished){ toast('Prenos že teče'); return; }

  // Najprej oceni število
  const z1 = 14, z2 = 18;
  const urls = tilesForParcels(state.parcels, z1, z2, ['osm', 'sat']);
  const approxMB = (urls.length * 15) / 1024;
  if (!confirm(`Predprenesi ${urls.length} tile-ov za ${state.parcels.length} parcel?\n\nOcena prostora: ~${approxMB.toFixed(0)} MB\nZoom nivoji: ${z1}–${z2}\nProvider: OSM + satelit\n\nPrenos lahko traja nekaj minut. Najbolje preko WiFi.`)) return;

  // Ustvari progress dialog
  const body = $('#modalBody');
  body.innerHTML = `
    <div style="text-align:center;padding:10px">
      <div style="font-size:14px;margin-bottom:8px">Prenašanje tile-ov…</div>
      <div class="progressbar" style="margin:14px 0"><div class="progressfill" id="dlProgress" style="width:0%"></div></div>
      <div id="dlStatus" style="font-size:12px;color:var(--muted)">Pripravljam…</div>
      <div class="btn-row" style="margin-top:14px">
        <button class="minibtn danger" id="dlCancelBtn">Prekini</button>
      </div>
    </div>
  `;
  $('#modalScrim').classList.add('open');
  let cancelled = false;
  $('#dlCancelBtn').onclick = () => { cancelled = true; toast('Prekinjam…'); };

  state.tileDownload = { abort: () => { cancelled = true; }, done: 0, total: urls.length, finished: false };

  await downloadTiles(urls, (p) => {
    if (cancelled) return;
    if ($('#dlProgress')) $('#dlProgress').style.width = (100 * p.done / p.total).toFixed(1) + '%';
    if ($('#dlStatus')) $('#dlStatus').textContent = `${p.done} / ${p.total}` + (p.errors ? ` (${p.errors} napak)` : '');
  }, { abortSignal: { get aborted(){ return cancelled; } } });

  state.tileDownload.finished = true;
  closeModal();
  toast(cancelled ? 'Prekinjeno' : 'Predprenos končan');
  renderSettings();
}

async function renderSettings(){
  const est = await storageEstimate();
  $('#settingsParcelsCount').textContent = state.parcels.length + ' parcel';
  const sessions = await savedSessions();
  $('#settingsSessionsCount').textContent = sessions.length + ' sej';
  $('#settingsStorageUsage').textContent = est
    ? est.usedMB.toFixed(1) + ' MB / ' + est.quotaMB.toFixed(0) + ' MB'
    : 'ni podatka';

  // Offline tile cache info
  const tiles = await tileCacheStats();
  if ($('#settingsTilesCount')){
    $('#settingsTilesCount').textContent = tiles.count + ' tile-ov (~' + tiles.approxMB.toFixed(0) + ' MB)';
  }

  // Radio
  $$('input[name=settingsGpsSrc]').forEach(r => { r.checked = (r.value === state.settings.gpsSource); });
  $('#settingsAutoParcel').checked = state.settings.autoSelectParcel;
  $('#settingsDayMode').checked = state.settings.dayTheme;
  $('#settingsUseBleActive').checked = state.settings.useBleMachineActive;
  $('#settingsUseBleWidth').checked = state.settings.useBleWidth;

  $('#settingsBleStatus').textContent = ble.connected
    ? 'Povezano: ' + (ble.device?.name || '?')
    : (ble.isSupported() ? 'Ni povezano' : 'Brskalnik ne podpira BLE');
  $('#settingsBleBtn').textContent = ble.connected ? 'Prekini' : 'Poveži';
  $('#settingsBleBtn').disabled = !ble.isSupported();

  $('#settingsOnlineStatus').textContent = state.online ? 'Online' : 'Offline';

  renderOpsList();
  renderMachinesList();
  renderLayersList();

  const ua = navigator.userAgent;
  $('#settingsBrowser').textContent = ua.length > 80 ? ua.slice(0, 80) + '…' : ua;

  // Dejanska nameščena verzija (iz imena SW predpomnilnika) + ročna preverba
  caches.keys().then(keys => {
    const v = keys.filter(k => k.startsWith('agrotracker-app-')).sort().pop() || '—';
    const el = $('#settingsCacheVer');
    if (el) el.textContent = v.replace('agrotracker-app-', 'predpomnilnik ');
  }).catch(()=>{});
  $('#settingsUpdateBtn').onclick = async () => {
    toast('Preverjam posodobitev…');
    try {
      const reg = await navigator.serviceWorker.getRegistration();
      if (reg){
        await reg.update();
        setTimeout(() => toast('Če je na voljo nova verzija, se bo app sam osvežil.', 3500), 1200);
      } else toast('Service worker ni registriran.');
    } catch (e){ toast('Napaka: ' + (e.message || e), 3000); }
  };
}

async function importGeoJSON(gj){
  // Sprejmemo FeatureCollection ali posamezen Feature
  const feats = (gj.type === 'FeatureCollection') ? gj.features :
                (gj.type === 'Feature') ? [gj] : null;
  if (!feats) throw new Error('Ni FeatureCollection ali Feature.');
  let added = 0;
  for (const f of feats){
    if (!f.geometry) continue;
    if (f.geometry.type !== 'Polygon' && f.geometry.type !== 'MultiPolygon') continue;
    const name = f.properties?.name ||
                 f.properties?.NAME ||
                 f.properties?.GERK_PID ||
                 f.properties?.ID ||
                 'Parcela';
    const p = {
      id: f.properties?.id || newId('par'),
      name: String(name),
      ha: f.properties?.ha ?? f.properties?.POVRSINA ?? featureHa(f),
      feature: f,
      gerkPid: f.properties?.GERK_PID ?? null,
      raba: f.properties?.RABA_ID ?? null,
      source: 'import',
      createdAt: Date.now()
    };
    await saveParcel(p);
    added++;
  }
  if (added === 0) throw new Error('Nič veljavnih (Polygon) feature-jev.');
  return added;
}

// ============ EXPOSED FOR DEBUG ============
window._app = { state, gps, ble, startSession, stopSession,
  _dbg: { covGridSize: () => _covGrid.size, overlapHits: () => _overlapHits } };

init().catch(err => {
  console.error('Init failed', err);
  document.body.innerHTML = '<div style="padding:40px;color:#fff;font-family:sans-serif">Napaka pri zagonu: ' + err.message + '</div>';
});
