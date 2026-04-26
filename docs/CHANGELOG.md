# Changelog

Vse pomembnejše spremembe v projektu AgroTracker.

Format: [verzija] - YYYY-MM-DD

---

## [v2.3] - 2026-04-26

### Dodano

- `AGENTS.md` v root mapi — navodila za AI agente in nove sodelavce
  - Vrstni red branja dokumentacije
  - Kontekst projekta v eni minuti
  - Tehnični stack (fiksne odločitve)
  - Standardi kode
  - Pasti, na katere paziti
  - Brezpogojno NE delaj seznam
  - Kako končati spremembe (test → changelog → commit)

### Spremenjeno

- Root `README.md` referenca na `AGENTS.md`

---

## [v2.2] - 2026-04-26

### Dokumentacija razširjena

Po debati z uporabnikom o naslednjih korakih, dokumentacija PROJECT.md razširjena z:

- Akcijski plan za prvi terenski test (po vrstnem redu, od najlažjega)
- Razširjen razdelek o cloud sync (7 opcij od Google Drive do CRDT peer-to-peer)
- Razširjen razdelek o ESP32 SD logger-ju (hibrid način, cene, integracija)
- Razširjen razdelek o iPhone podpori (Bluefy, Capacitor, sprejetje)
- Nove ideje: SMS/GSM obveščanje, ARSO vreme, multi-uporabnik
- Pojasnilo, zakaj APK ne reši cloud sync-a

### Brez kode sprememb

Samo dokumentacija. Funkcionalnost ostaja iz v2.1.

---

## [v2.1] - 2026-04-26

### Dodano
- Predprenos tile-ov za vse parcele (Settings → Offline kartica)
- Online/Offline pill na karti, samodejno se posodablja
- Tipka "Backup vseh sej" — izvoz vseh sej kot en GeoJSON
- Števec predprenešenih tile-ov in MB ocena
- Tipka "Izbriši tile cache"
- `js/offline.js` modul s tilesForBounds, tilesForParcels, downloadTiles
- `docs/PROJECT.md` — popolna dokumentacija projekta
- `docs/CHANGELOG.md` — ta dokument

### Spremenjeno
- Service worker verzija APP_CACHE: v2 → v3 (forsira osvežitev pri uporabnikih)
- Sprejemanje opaque odgovorov v tile cache-u (za ArcGIS satelit)
- Kartica "Podatki" v Nastavitvah razdeljena: Backup tipka + Reset tipka

### Opombe
- Po posodobitvi obstoječi uporabniki morajo: zapreti app, znova odpreti, da SW pobere novo verzijo
- Ali: Settings → Apps → AgroTracker → Storage → Clear data, nato znova odpreti

---

## [v2.0] - 2026-04-23

### Dodano
- Pravi telefonski GPS preko `navigator.geolocation`
- Web Bluetooth klient za povezavo z ESP32 modulom
- IndexedDB shranjevanje (parcele, seje, nastavitve)
- Zgodovina sej z metrikami (ha, čas, prevoženo, prehodi)
- Pavza / nadaljuj / shrani sejo
- 7 tipov operacij (setev, gnojevka, mineralno, škropljenje, košnja, spravilo, drugo) z barvami in enotami
- 7 strojev s privzetimi širinami
- Avtomatska izbira parcele po GPS
- Auto-save sej (vsakih 8 sekund)
- Uvoz GeoJSON parcel (FeatureCollection / Feature)
- Izvoz seje + vseh sej kot GeoJSON
- Status pill-i (GPS / BLE / Online)
- Service worker (offline shell + tile cache)
- Slovenski jezik povsod
- Veliki gumbi (za prste v rokavicah)
- ESP32 firmware (BLE GATT + GPS + RS485 + SIM_MODE)
- Dokumentacija (`PROTOCOL.md`, `README.md`)
- Demo parcele za prvi zagon

### Spremenjeno
- Reorganizacija iz enega `index.html` v modularno strukturo
- 8 ES modulov (app, constants, geo, storage, ble, gps, map, session)
- Leaflet lokalno v `vendor/` (offline pripravljen)

### Tehnično
- Namesto unpkg CDN: `vendor/leaflet.{js,css}`
- Iz `--break-system-packages` instalacij: PlatformIO za ESP32
- Custom 128-bit BLE UUID-ji (ne Nordic UART)
- JSON paketi: `tel`, `gps`, `pong`
- RS485 line-protocol: `KEY:VALUE\n`

### Testirano
- Avtomatski Playwright test cele lifecycle (start → vožnja → save → history → import GeoJSON → druga seja)
- 0 page errors
- Multiple operacije, switch barv, pavza/nadaljuj OK

---

## [v1] - 2026-03

### Začetek projekta
- En `index.html` z inline CSS in JS
- Leaflet karta, izbira parcele, ročna simulacija vožnje
- Trakovi pokritja po širini stroja
- Brez pravega GPS-a (samo simulacija)
- Brez shranjevanja
- Brez BLE
- Demo parcele trdo kodirane

### Naslednji načrtovani koraki (takrat)
1. PWA fullscreen + ročna simulacija
2. BLE povezava z ESP32
3. Format podatkov stroja (active, machine, width, speed, gps source, optional flow)
4. Resen zunanji GPS

(Vsi ti koraki so bili dokončani v v2.0)
