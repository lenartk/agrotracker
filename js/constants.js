// Operacije (tipi dela) — vsaka ima svojo barvo in enoto vrednosti
export const OPERATIONS = {
  seed: {
    id: 'seed',
    name: 'Setev',
    icon: '🌱', svg: 'sprout',
    color: '#22c55e',
    fillOpacity: 0.38,
    valueLabel: 'Seme',
    valueUnit: 'kg/ha',
    hint: 'Barva pokritje samo, ko je sejalnica aktivna.',
    requiresActive: true,
    defaultMachines: ['sejalnica']
  },
  fertilize_liquid: {
    id: 'fertilize_liquid',
    name: 'Gnojevka',
    icon: '💧', svg: 'droplet',
    color: '#a855f7',
    fillOpacity: 0.38,
    valueLabel: 'Gnojevka',
    valueUnit: 'm³/ha',
    hint: 'Barva pokritje samo, ko je ventil cisterne odprt.',
    requiresActive: true,
    defaultMachines: ['cisterna']
  },
  fertilize_solid: {
    id: 'fertilize_solid',
    name: 'Mineralno gnojilo',
    icon: '🌾', svg: 'scatter',
    color: '#f59e0b',
    fillOpacity: 0.38,
    valueLabel: 'Gnojilo',
    valueUnit: 'kg/ha',
    hint: 'Barva pokritje samo, ko trosilec trosi.',
    requiresActive: true,
    defaultMachines: ['trosilec']
  },
  spray: {
    id: 'spray',
    name: 'Škropljenje',
    icon: '💨', svg: 'wind',
    color: '#06b6d4',
    fillOpacity: 0.32,
    valueLabel: 'Škropivo',
    valueUnit: 'l/ha',
    hint: 'Barva pokritje samo, ko je škropilnica aktivna.',
    requiresActive: true,
    defaultMachines: ['skropilnica']
  },
  mow: {
    id: 'mow',
    name: 'Košnja',
    icon: '✂️', svg: 'scissors',
    color: '#84cc16',
    fillOpacity: 0.42,
    valueLabel: 'Prevoženo',
    valueUnit: 'km',
    hint: 'Barva pokritje ves čas sledenja.',
    requiresActive: false,
    defaultMachines: ['kosilnica']
  },
  harvest: {
    id: 'harvest',
    name: 'Spravilo',
    icon: '🚜', svg: 'wheat',
    color: '#eab308',
    fillOpacity: 0.40,
    valueLabel: 'Pridelek',
    valueUnit: 't/ha',
    hint: 'Barva pokritje samo, ko je boben / spravilo aktivno.',
    requiresActive: true,
    defaultMachines: ['nakladalna', 'kombajn']
  },
  transport: {
    id: 'transport',
    name: 'Prevoz',
    icon: '🚚', svg: 'route',
    color: '#94a3b8',
    fillOpacity: 0.0,
    valueLabel: 'Prevoženo',
    valueUnit: 'km',
    hint: 'Samo pot (tanka črta) — brez barvanja pokritosti.',
    requiresActive: false,
    noPaint: true,
    defaultMachines: []
  },
  custom: {
    id: 'custom',
    name: 'Drugo',
    icon: '🔧', svg: 'wrench',
    color: '#38bdf8',
    fillOpacity: 0.35,
    valueLabel: 'Vrednost',
    valueUnit: '',
    hint: 'Ročno sledenje, poljuben namen.',
    requiresActive: false,
    defaultMachines: []
  }
};

// Privzeti stroji (uporabnik jih lahko razširi v nastavitvah, v tej fazi so fiksni)
export const MACHINES = [
  { id: 'sejalnica',   name: 'Sejalnica',    width: 3.0,  icon: '🌱', svg: 'sprout', tag: 'setev', defaultOp: 'seed' },
  { id: 'cisterna',    name: 'Cisterna',     width: 10.0, icon: '💧', svg: 'droplet', tag: 'gnojevka', defaultOp: 'fertilize_liquid' },
  { id: 'trosilec',    name: 'Trosilec',     width: 12.0, icon: '🌾', svg: 'scatter', tag: 'gnojilo', defaultOp: 'fertilize_solid' },
  { id: 'skropilnica', name: 'Škropilnica',  width: 15.0, icon: '💨', svg: 'wind', tag: 'škropljenje', defaultOp: 'spray' },
  { id: 'kosilnica',   name: 'Kosilnica',    width: 2.4,  icon: '✂️', svg: 'scissors', tag: 'košnja', defaultOp: 'mow' },
  { id: 'nakladalna',  name: 'Nakladalna',   width: 2.8,  icon: '🚜', svg: 'wheat', tag: 'spravilo', defaultOp: 'harvest' },
  { id: 'kombajn',     name: 'Kombajn',      width: 4.5,  icon: '🌽', tag: 'žetev', defaultOp: 'harvest' }
];

// BLE UUIDs za ESP32 modul — morata se ujemati s firmware-om.
// Generirano kot custom 128-bit UUID-ji (ne Nordic UART — samostojna specifikacija).
export const BLE = {
  SERVICE:    '6b00a11e-1111-4a50-8000-000000000001',
  TX_CHAR:    '6b00a11e-1111-4a50-8000-000000000002', // ESP32 -> telefon (notify)
  RX_CHAR:    '6b00a11e-1111-4a50-8000-000000000003', // telefon -> ESP32 (write)
  INFO_CHAR:  '6b00a11e-1111-4a50-8000-000000000004', // read-only, firmware info
  NAME_PREFIX: 'AgroESP'
};

// AB guidance (lightbar) parametri
export const GUIDANCE = {
  cmPerDot: 10,       // ena pika lightbar-a = 10 cm odklona  // ponytail: fiksna skala, nastavitev dodamo po terenski izkušnji
  dots: 5,            // pik na vsako stran
  okCm: 10,           // do tu zeleno
  warnCm: 30,         // nad tem rdeče + pisk
  beepEveryMs: 2500,  // najmanj toliko med piski
  linesEachSide: 6    // koliko vzporednih linij rišemo na vsako stran aktivne
};

// Privzete vrednosti
export const DEFAULTS = {
  center: [46.0515, 14.503],
  zoom: 16,
  workedOpacity: 0.38,
  simSpeedKmh: 8,
  gpsMinDistM: 0.4,          // ne zapisuj točk, če smo se premaknili manj
  gpsMaxIntervalMs: 2000,    // a če je mimo tega časa, kljub temu zapiši
  paintSampleMinMs: 250,     // minimalno med risanji trakov
  autoSaveMs: 8000,          // auto-save seje
  historyTrackMax: 5000      // koliko točk obdržimo v seji (varovalka)
};
