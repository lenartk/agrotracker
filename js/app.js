// Glavni kontroler aplikacije. Upravlja:
//  - preklop med pogledi (home / map / history / settings)
//  - stanje seje (start/pause/stop/save)
//  - povezava GPS + BLE + karta + storage
//  - UI event wiring

import { OPERATIONS, MACHINES, DEFAULTS } from './constants.js';
import { MapController } from './map.js';
import { gps } from './gps.js';
import { ble } from './ble.js';
import { Session } from './session.js';
import {
  savedParcels, saveParcel, deleteParcel, clearParcels,
  savedSessions, saveSession, deleteSession, getSession,
  getKV, setKV, newId, storageEstimate
} from './storage.js';
import {
  featureHa, bboxOfFeature, centroidOfFeature, pointInFeature,
  formatDistance, formatDuration
} from './geo.js';

// ============ STATE ============
const state = {
  view: 'home',
  parcels: [],
  session: null,
  map: null,
  telemetry: { active: null, width: null, flow: null, rs485ok: false, machine: null },
  settings: {
    gpsSource: 'phone',      // phone | ble | sim
    simSpeedKmh: DEFAULTS.simSpeedKmh,
    workedOpacity: DEFAULTS.workedOpacity,
    widthOverride: null,
    autoSelectParcel: true,
    useBleMachineActive: true,   // uporabi active iz BLE, sicer privzeto true
    useBleWidth: true,           // uporabi širino iz BLE, sicer ročno
  },
  // Home
  selectedOpId: 'seed',
  selectedMachineId: 'sejalnica',
  selectedParcelId: null,
  note: ''
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

function showView(name){
  state.view = name;
  $$('.view').forEach(v => v.classList.remove('active'));
  const el = document.getElementById('view-' + name);
  if (el) el.classList.add('active');
  // Karta potrebuje invalidate size, ko pokažemo njen view
  if (name === 'map' && state.map){
    setTimeout(() => state.map.map && state.map.map.invalidateSize(), 50);
  }
  if (name === 'history') renderHistory();
  if (name === 'settings') renderSettings();
}

function nowIso(){ return new Date().toISOString(); }
function fmtTs(ms){
  const d = new Date(ms);
  return d.toLocaleDateString('sl-SI') + ' ' + d.toLocaleTimeString('sl-SI', { hour: '2-digit', minute: '2-digit' });
}

// ============ INIT ============
async function init(){
  // Load settings
  const s = await getKV('settings');
  if (s) Object.assign(state.settings, s);

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

  // Wire UI
  wireHome();
  wireMap();
  wireDrawer();
  wireHistoryView();
  wireSettingsView();

  // Default view
  renderHome();
  showView('home');

  // Register SW
  if ('serviceWorker' in navigator){
    navigator.serviceWorker.register('./sw.js').catch(console.error);
  }

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

// ============ HOME VIEW ============
function renderHome(){
  // Operacije
  const opGrid = $('#opGrid');
  opGrid.innerHTML = Object.values(OPERATIONS).map(op => `
    <button class="op-card ${state.selectedOpId === op.id ? 'selected' : ''}" data-id="${op.id}">
      <div class="op-icon" style="background:${op.color}22;border:1px solid ${op.color}55">${op.icon}</div>
      <div class="op-name">${op.name}</div>
      <div class="op-desc">${op.valueLabel}${op.valueUnit ? ' • ' + op.valueUnit : ''}</div>
    </button>
  `).join('');
  opGrid.querySelectorAll('.op-card').forEach(btn => {
    btn.onclick = () => { state.selectedOpId = btn.dataset.id; autoPickMachineForOp(); renderHome(); };
  });

  // Stroji
  const machRow = $('#machineRow');
  machRow.innerHTML = MACHINES.map(m => `
    <button class="picker-chip ${state.selectedMachineId === m.id ? 'selected' : ''}" data-id="${m.id}">
      <span>${m.icon} ${m.name}</span>
      <small>${m.width.toFixed(1)} m</small>
    </button>
  `).join('');
  machRow.querySelectorAll('.picker-chip').forEach(btn => {
    btn.onclick = () => { state.selectedMachineId = btn.dataset.id; renderHome(); };
  });

  // Parcele
  const parcelRow = $('#parcelRow');
  if (state.parcels.length === 0){
    parcelRow.innerHTML = '<div class="empty-state small">Ni parcel. Uvozi GeoJSON v nastavitvah.</div>';
  } else {
    parcelRow.innerHTML = state.parcels.map(p => `
      <button class="picker-chip ${state.selectedParcelId === p.id ? 'selected' : ''}" data-id="${p.id}">
        <span>${escapeHtml(p.name)}</span>
        <small>${p.ha.toFixed(2)} ha</small>
      </button>
    `).join('');
    parcelRow.querySelectorAll('.picker-chip').forEach(btn => {
      btn.onclick = () => { state.selectedParcelId = btn.dataset.id; renderHome(); };
    });
  }

  // Note
  $('#homeNote').value = state.note;

  // Start button enabled?
  const startBtn = $('#homeStartBtn');
  startBtn.disabled = !(state.selectedOpId && state.selectedMachineId);
}

function autoPickMachineForOp(){
  const op = OPERATIONS[state.selectedOpId];
  if (!op || !op.defaultMachines?.length) return;
  // Če trenutno izbran stroj ni med priporočenimi, preklopi na prvega priporočenega
  if (!op.defaultMachines.includes(state.selectedMachineId)){
    state.selectedMachineId = op.defaultMachines[0];
  }
}

function wireHome(){
  $('#homeSettingsBtn').onclick = () => showView('settings');
  $('#homeHistoryBtn').onclick = () => showView('history');
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

  state.map.onParcelClick = (id) => {
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
    gps.setSimTarget({ lat: e.latlng.lat, lng: e.latlng.lng });
  });

  return state.map;
}

function refreshParcelsOnMap(){
  if (!state.map) return;
  const feats = state.parcels.map(p => ({
    ...p.feature,
    id: p.id,
    properties: { ...(p.feature.properties || {}), name: p.name, ha: p.ha }
  }));
  state.map.setParcels(feats, state.selectedParcelId);
}

function setSimTargetFromPointer(ev){
  if (!state.map) return;
  const rect = ev.currentTarget.getBoundingClientRect();
  const x = ev.clientX - rect.left, y = ev.clientY - rect.top;
  const ll = state.map.map.containerPointToLatLng(L.point(x, y));
  gps.setSimTarget({ lat: ll.lat, lng: ll.lng });
}

function wireMap(){
  $('#mapMenuBtn').onclick = () => openDrawer();
  $('#mapCenterBtn').onclick = () => {
    const f = gps.lastFix;
    if (f) state.map.centerOn([f.lat, f.lng]);
    else if (state.selectedParcelId) state.map.fitToParcel(state.selectedParcelId);
    else state.map.fitToAllParcels();
  };
  $('#mapTerrainBtn').onclick = () => {
    const onSat = state.map.toggleSatellite();
    toast(onSat ? 'Satelit' : 'Zemljevid');
  };
  $('#mapLayersBtn').onclick = () => {
    state.map.follow = !state.map.follow;
    toast('Sredina: ' + (state.map.follow ? 'ON' : 'OFF'));
  };

  $('#startBtn').onclick = () => {
    if (!state.session) { startSession(); return; }
    if (state.session.state === 'paused') resumeSession();
    else toast('Seja že teče');
  };
  $('#pauseBtn').onclick = () => pauseSession();
  $('#stopBtn').onclick = () => confirmStopSession();
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
  const op = s ? OPERATIONS[s.operation.id] : OPERATIONS[state.selectedOpId];
  const w = effectiveWidthM();
  $('#drawerOp').textContent = op ? `${op.icon} ${op.name}` : '—';
  $('#drawerMachine').textContent = s?.machine ? `${s.machine.icon} ${s.machine.name}` : '—';
  $('#drawerParcel').textContent = s?.parcel ? s.parcel.name : (state.selectedParcelId ? state.parcels.find(p => p.id === state.selectedParcelId)?.name : '—');
  $('#drawerWidth').textContent = w.toFixed(1) + ' m';
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
    $('#drawerWidth').textContent = effectiveWidthM().toFixed(1) + ' m';
    persistSettings();
  };
  $$('#drawerGpsRadios input[type=radio]').forEach(r => {
    r.onchange = () => { if (r.checked) setGpsSource(r.value); };
  });
  $('#drawerClearBtn').onclick = () => {
    if (!state.session) { toast('Ni aktivne seje.'); return; }
    if (!confirm('Počisti trenutno barvanje?')) return;
    if (state.map) state.map.clearCoverage();
    state.session.strips = [];
    state.session.coveredHa = 0;
    state.session.passes = 0;
    updateMapStats();
    toast('Počiščeno');
  };
  $('#drawerGoHome').onclick = () => {
    if (state.session && state.session.state === 'running'){
      if (!confirm('Seja teče. Odprti pogled Domov (seja ostane)?')) return;
    }
    closeDrawer();
    showView('home');
  };
  $('#drawerToHistory').onclick = () => { closeDrawer(); showView('history'); };
  $('#drawerToSettings').onclick = () => { closeDrawer(); showView('settings'); };
}

function effectiveWidthM(){
  if (state.settings.widthOverride) return state.settings.widthOverride;
  if (state.settings.useBleWidth && state.telemetry.width && state.telemetry.width > 0) return state.telemetry.width;
  if (state.session?.machine) return state.session.machine.width;
  const m = MACHINES.find(x => x.id === state.selectedMachineId);
  return m ? m.width : 3.0;
}

function effectiveMachineActive(){
  // Če imamo BLE in uporabnik uporablja BLE active signal:
  if (state.settings.useBleMachineActive && state.telemetry.active != null){
    return state.telemetry.active;
  }
  // Sicer: če seja teče, je "aktivno". Za opcije requiresActive=false to sploh ni pomembno (paint vseeno).
  return state.session ? state.session.state === 'running' : false;
}

// ============ SESSION LIFECYCLE ============
function startSession(){
  if (state.session && state.session.state !== 'stopped'){
    toast('Seja že teče');
    return;
  }
  const op = OPERATIONS[state.selectedOpId];
  const machine = MACHINES.find(m => m.id === state.selectedMachineId);
  const parcel = state.parcels.find(p => p.id === state.selectedParcelId) || null;

  state.session = new Session({ operation: op, machine, parcel, note: state.note });
  state.session.start();

  // Najprej pokaži map view, da lahko karta pravilno izračuna velikost
  showView('map');
  ensureMap();

  const finalOpacity = op.fillOpacity * (state.settings.workedOpacity / DEFAULTS.workedOpacity);
  state.map.setPaintStyle(op.color, Math.min(1, Math.max(0.05, finalOpacity)));
  state.map.clearCoverage();

  // Naslov na mapi
  $('#mapParcelName').textContent = parcel ? parcel.name : '—';
  $('#mapMachineName').textContent = `${op.icon} ${op.name} • ${machine.name} • ${effectiveWidthM().toFixed(1)} m`;

  // Fit na parcelo (po invalidateSize)
  setTimeout(() => {
    if (state.map){
      state.map.map.invalidateSize();
      if (parcel) state.map.fitToParcel(parcel.id);
    }
  }, 60);

  // Če ima parcela bbox in ni zadnjega fixa, postavi sim na centroid
  if (gps.source === 'sim' && !gps.lastFix){
    const c = parcel ? centroidOfFeature(parcel.feature) : { lat: DEFAULTS.center[0], lng: DEFAULTS.center[1] };
    gps.setSimPosition(c);
    state.map.setVehicleLatLng([c.lat, c.lng]);
  }

  setTrackingUI('running');
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
function confirmStopSession(){
  if (!state.session) { toast('Ni aktivne seje.'); return; }
  if (!confirm('Zaključi in shrani sejo?')) return;
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
    badge.textContent = 'Aktivno'; badge.className = 'badge on';
    $('#startBtn').textContent = 'Teče';
    $('#startBtn').disabled = true;
    $('#pauseBtn').disabled = false;
    $('#stopBtn').disabled = false;
  } else if (status === 'paused'){
    badge.textContent = 'Pavza'; badge.className = 'badge pause';
    $('#startBtn').textContent = 'Nadaljuj';
    $('#startBtn').disabled = false;
    $('#pauseBtn').disabled = true;
    $('#stopBtn').disabled = false;
  } else if (status === 'stopped'){
    badge.textContent = 'Končano'; badge.className = 'badge off';
    $('#startBtn').textContent = 'Začni novo';
    $('#startBtn').disabled = false;
    $('#pauseBtn').disabled = true;
    $('#stopBtn').disabled = true;
  } else {
    badge.textContent = 'Ustavljeno'; badge.className = 'badge off';
    $('#startBtn').textContent = 'Začni';
    $('#startBtn').disabled = false;
    $('#pauseBtn').disabled = true;
    $('#stopBtn').disabled = true;
  }
}

// ============ GPS FIX HANDLING ============
function onFix(fix){
  if (!state.map) return;
  state.map.setVehicleLatLng([fix.lat, fix.lng]);
  if (fix.headingDeg != null) state.map.setVehicleHeading(fix.headingDeg);
  state.map.softFollow([fix.lat, fix.lng]);

  // Auto-select parcele
  if (state.settings.autoSelectParcel && !state.session){
    const hit = state.parcels.find(p => pointInFeature({lat:fix.lat,lng:fix.lng}, p.feature));
    if (hit && hit.id !== state.selectedParcelId){
      state.selectedParcelId = hit.id;
      state.map.highlightParcel(hit.id);
      $('#mapParcelName').textContent = hit.name;
    }
  }

  // Posodobi stats (hitrost, GPS kakovost)
  $('#speedVal').textContent = (fix.spdKmh || 0).toFixed(1);
  $('#gpsAccuracy').textContent = fix.accuracyM ? '±' + fix.accuracyM.toFixed(0) + 'm' : '—';
  refreshGpsPill(fix);

  // Če seja teče, dodaj fix v track + morda nariši trak
  if (state.session && state.session.state === 'running'){
    const active = effectiveMachineActive();
    state.map.setVehicleActive(active || !state.session.operation.requiresActive);
    const widthM = effectiveWidthM();
    const flow = state.telemetry.flow ?? null;
    const res = state.session.addFix(fix, active, widthM, flow);
    if (res.painted && res.stripCoords){
      // MapController sam ne ve za nov segment — pokličimo paint
      state.map.paintSegment(
        { lat: state.session.track[state.session.track.length - 2].lat, lng: state.session.track[state.session.track.length - 2].lng },
        { lat: fix.lat, lng: fix.lng },
        widthM
      );
    }
    updateMapStats();
  } else if (state.session && state.session.state === 'paused'){
    state.map.setVehicleActive(false);
  }
}

function updateMapStats(){
  const s = state.session;
  if (!s) return;
  $('#doneVal').textContent = s.coveredHa.toFixed(3);
  $('#passesVal').textContent = String(s.passes);
  $('#widthVal').textContent = effectiveWidthM().toFixed(1);
  if (s.parcel){
    const pct = Math.min(100, Math.round((s.coveredHa / s.parcel.ha) * 100));
    $('#pctVal').textContent = pct + '%';
    $('#progressFill').style.width = pct + '%';
  } else {
    $('#pctVal').textContent = '—';
    $('#progressFill').style.width = '0%';
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
  pill.className = 'pill ' + cls;
  pill.innerHTML = '<span class="dot"></span>' + label;
}

function refreshBlePill(){
  const pill = $('#blePill');
  if (!pill) return;
  if (ble.connected){
    pill.className = 'pill ok';
    pill.innerHTML = '<span class="dot"></span>BLE';
  } else {
    pill.className = 'pill';
    pill.innerHTML = '<span class="dot"></span>Brez stroja';
  }
}

function refreshTelemetryUI(){
  // Če je BLE povezan in pošilja active, posodobi vozilo
  if (state.map && state.session){
    const active = effectiveMachineActive();
    state.map.setVehicleActive(active || !state.session.operation.requiresActive);
  }
  // Posodobi širino v label-u
  $('#widthVal') && ($('#widthVal').textContent = effectiveWidthM().toFixed(1));
  // Drawer widths
  if (document.getElementById('drawerWidth')){
    document.getElementById('drawerWidth').textContent = effectiveWidthM().toFixed(1) + ' m';
  }
  // Flow
  if ($('#flowVal') && state.telemetry.flow != null){
    $('#flowVal').textContent = state.telemetry.flow.toFixed(1);
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
      setTimeout(() => {
        if (confirm('Uporabim GPS iz ESP32 modula?')){
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

async function persistSettings(){
  try { await setKV('settings', state.settings); } catch {}
}

// ============ HISTORY VIEW ============
async function renderHistory(){
  const list = $('#historyList');
  const sessions = await savedSessions();
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
          <div class="session-icon" style="background:${op.color || '#22c55e'}30;color:${op.color || '#22c55e'}">${op.icon || '🚜'}</div>
          <div class="session-info">
            <div class="session-title">${escapeHtml(op.name || 'Opravilo')} • ${escapeHtml(s.machine?.name || '')}</div>
            <div class="session-date">${fmtTs(s.startedAt)}${s.parcel ? ' • ' + escapeHtml(s.parcel.name) : ''}</div>
          </div>
        </div>
        <div class="session-metrics">
          <div class="session-metric"><div class="v">${(s.coveredHa || 0).toFixed(2)}</div><div class="l">ha</div></div>
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
      <div class="session-icon" style="background:${op.color || '#22c55e'}30;color:${op.color || '#22c55e'};font-size:28px;width:52px;height:52px;border-radius:14px">${op.icon || '🚜'}</div>
      <div>
        <div style="font-weight:800">${escapeHtml(op.name || '—')}</div>
        <div class="small muted">${fmtTs(s.startedAt)}${s.endedAt ? ' – ' + new Date(s.endedAt).toLocaleTimeString('sl-SI', {hour:'2-digit', minute:'2-digit'}) : ''}</div>
      </div>
    </div>
    <div class="session-metrics" style="grid-template-columns:repeat(2,1fr)">
      <div class="session-metric"><div class="v">${(s.coveredHa || 0).toFixed(3)}</div><div class="l">ha</div></div>
      <div class="session-metric"><div class="v">${formatDistance(s.distanceM || 0)}</div><div class="l">pot</div></div>
      <div class="session-metric"><div class="v">${dur}</div><div class="l">čas</div></div>
      <div class="session-metric"><div class="v">${s.passes || 0}</div><div class="l">preh.</div></div>
      <div class="session-metric"><div class="v">${s.machine?.name || '—'}</div><div class="l">stroj</div></div>
      <div class="session-metric"><div class="v">${s.parcel?.name || '—'}</div><div class="l">parcela</div></div>
    </div>
    ${s.note ? `<div class="card" style="margin-top:10px"><div class="small muted">Opomba</div><div style="margin-top:4px">${escapeHtml(s.note)}</div></div>` : ''}
    <div class="btn-row" style="margin-top:12px">
      <button class="minibtn" id="modalExportBtn">Izvozi GeoJSON</button>
      <button class="minibtn danger" id="modalDeleteBtn">Izbriši sejo</button>
    </div>
  `;
  $('#modalScrim').classList.add('open');
  $('#modalExportBtn').onclick = () => exportSessionAsGeoJSON(s);
  $('#modalDeleteBtn').onclick = async () => {
    if (!confirm('Izbriši sejo?')) return;
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
        machine: s.machine?.name,
        startedAt: new Date(s.startedAt).toISOString(),
        coveredHa: s.coveredHa,
        distanceM: s.distanceM,
        color: s.operation?.color
      },
      geometry: { type: 'LineString', coordinates: s.track.map(p => [p.lng, p.lat]) }
    });
  }
  // Vsak strip kot Polygon
  (s.strips || []).forEach((strip, i) => {
    features.push({
      type: 'Feature',
      properties: { kind: 'coverage', sessionId: s.id, idx: i, operation: s.operation?.name, color: s.operation?.color },
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
    if (!confirm('Izbriši vse parcele?')) return;
    await clearParcels();
    state.parcels = [];
    toast('Izbrisano');
    renderSettings();
  };
  $('#settingsResetSettingsBtn').onclick = async () => {
    if (!confirm('Resetiraj nastavitve?')) return;
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
  $('#settingsUseBleActive').addEventListener('change', (e) => {
    state.settings.useBleMachineActive = e.target.checked;
    persistSettings();
  });
  $('#settingsUseBleWidth').addEventListener('change', (e) => {
    state.settings.useBleWidth = e.target.checked;
    persistSettings();
  });

  // Modal close
  $('#modalCloseBtn').onclick = closeModal;
  $('#modalScrim').addEventListener('click', (e) => { if (e.target.id === 'modalScrim') closeModal(); });
}

async function renderSettings(){
  const est = await storageEstimate();
  $('#settingsParcelsCount').textContent = state.parcels.length + ' parcel';
  const sessions = await savedSessions();
  $('#settingsSessionsCount').textContent = sessions.length + ' sej';
  $('#settingsStorageUsage').textContent = est
    ? est.usedMB.toFixed(1) + ' MB / ' + est.quotaMB.toFixed(0) + ' MB'
    : 'ni podatka';

  // Radio
  $$('input[name=settingsGpsSrc]').forEach(r => { r.checked = (r.value === state.settings.gpsSource); });
  $('#settingsAutoParcel').checked = state.settings.autoSelectParcel;
  $('#settingsUseBleActive').checked = state.settings.useBleMachineActive;
  $('#settingsUseBleWidth').checked = state.settings.useBleWidth;

  $('#settingsBleStatus').textContent = ble.connected
    ? 'Povezano: ' + (ble.device?.name || '?')
    : (ble.isSupported() ? 'Ni povezano' : 'Brskalnik ne podpira BLE');
  $('#settingsBleBtn').textContent = ble.connected ? 'Prekini' : 'Poveži';
  $('#settingsBleBtn').disabled = !ble.isSupported();

  const ua = navigator.userAgent;
  $('#settingsBrowser').textContent = ua.length > 80 ? ua.slice(0, 80) + '…' : ua;
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
window._app = { state, gps, ble, startSession, stopSession };

init().catch(err => {
  console.error('Init failed', err);
  document.body.innerHTML = '<div style="padding:40px;color:#fff;font-family:sans-serif">Napaka pri zagonu: ' + err.message + '</div>';
});
