// Enostaven IndexedDB wrapper. Tri store-i:
//   parcels  — uporabnikove parcele (GeoJSON + meta)
//   sessions — zapisana opravila (seje) z track-om in trakovi
//   kv       — key-value za nastavitve
//
// Vse async, vrne Promise-e. Ni dependency-ja na Dexie ipd.

const DB_NAME = 'agrotracker';
const DB_VERSION = 1;
let _dbPromise = null;

function openDB(){
  if (_dbPromise) return _dbPromise;
  _dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains('parcels')){
        const s = db.createObjectStore('parcels', { keyPath: 'id' });
        s.createIndex('name', 'name', { unique: false });
      }
      if (!db.objectStoreNames.contains('sessions')){
        const s = db.createObjectStore('sessions', { keyPath: 'id' });
        s.createIndex('startedAt', 'startedAt', { unique: false });
        s.createIndex('parcelId', 'parcelId', { unique: false });
      }
      if (!db.objectStoreNames.contains('kv')){
        db.createObjectStore('kv', { keyPath: 'k' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return _dbPromise;
}

function tx(storeName, mode = 'readonly'){
  return openDB().then(db => db.transaction(storeName, mode).objectStore(storeName));
}

function promisify(req){
  return new Promise((res, rej) => { req.onsuccess = () => res(req.result); req.onerror = () => rej(req.error); });
}

// ============ PARCELS ============

export async function savedParcels(){
  const store = await tx('parcels');
  return promisify(store.getAll());
}

export async function saveParcel(parcel){
  const store = await tx('parcels', 'readwrite');
  return promisify(store.put(parcel));
}

export async function deleteParcel(id){
  const store = await tx('parcels', 'readwrite');
  return promisify(store.delete(id));
}

export async function clearParcels(){
  const store = await tx('parcels', 'readwrite');
  return promisify(store.clear());
}

// ============ SESSIONS ============

export async function savedSessions(){
  const store = await tx('sessions');
  const all = await promisify(store.getAll());
  all.sort((a, b) => b.startedAt - a.startedAt);
  return all;
}

export async function saveSession(session){
  const store = await tx('sessions', 'readwrite');
  return promisify(store.put(session));
}

export async function getSession(id){
  const store = await tx('sessions');
  return promisify(store.get(id));
}

export async function deleteSession(id){
  const store = await tx('sessions', 'readwrite');
  return promisify(store.delete(id));
}

// ============ KV (settings) ============

export async function getKV(key, fallback = null){
  const store = await tx('kv');
  const r = await promisify(store.get(key));
  return r ? r.v : fallback;
}

export async function setKV(key, value){
  const store = await tx('kv', 'readwrite');
  return promisify(store.put({ k: key, v: value }));
}

// ============ UTIL ============

export function newId(prefix = 'id'){
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

// Ocena zasedenosti
export async function storageEstimate(){
  if (!navigator.storage || !navigator.storage.estimate) return null;
  const est = await navigator.storage.estimate();
  return {
    usedMB: (est.usage || 0) / 1024 / 1024,
    quotaMB: (est.quota || 0) / 1024 / 1024
  };
}
