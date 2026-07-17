# AgroTracker — RESUME (hitri vstop po restartu)

Zadnja posodobitev: 2026-07-17, verzija **v5.2.1** (SW cache v19), live na
`https://lenartk.github.io/agrotracker/`.

## Kaj je AgroTracker
PWA za GPS vodenje, sledenje obdelanim površinam in evidenco na kmetiji.
Telefon je terminal + karta; ESP32 modul (BLE) na stroju pošilja telemetrijo,
po RS485 posluša sejalnico. Cilj: dostopno precizno kmetijstvo. Lastnik
kmetije (KMG-MID **100220160**, kraška regija, pretežno travniki + njive).

## Delovna lokacija in deploy
- **Glavna koda:** `~/workspace/agrotracker` (git, remote `git@github.com:lenartk/agrotracker`, SSH push kot lenartk dela).
- `~/Downloads/Agrotracker/Projekti/` = sinhronizirana kopija (rsync po vsakem deployu).
- Repo ima tudi `gpt/` podmapo (uporabnikov ločen eksperiment) — NE dotikaj.
- **Deploy = git push na main → GitHub Pages** (~1–3 min). Vedno počakaj potrditev:
  `until curl -s .../sw.js | grep -q "agrotracker-app-vNN"; do sleep 10; done` (run_in_background).
- **Ob VSAKI spremembi PWA zvišaj `APP_CACHE` v `sw.js`** (trenutno v18). Od v4.2.1
  se telefon posodablja sam (install s `cache:'reload'` + controllerchange reload).

## Arhitektura (js/, vanilla ES moduli, brez bundlerja)
- `app.js` — glavni kontroler (State, view switching, seje, UI wiring, izvozi). Velik.
- `map.js` — **MapLibre GL** ovojnica (od v4.0; prej Leaflet — menjava zaradi 3D
  terena). Viri: sat/osm raster, dem (terrarium), + geojson: parcels/prevcov/drive/
  cov/guide/impl/overlay/sel. Ready-queue `_run()` za async style load.
- `guidance.js` — AB vodenje (lightbar), test_guidance.mjs.
- `gps.js` — phone/ble/sim viri + glajenje (smoothPosition/smoothHeading v geo.js).
- `geo.js` — geometrija: createStrip(latOffM), offsetBack, trailedFollow, fmtNum
  (sl-SI vejica), GPS_FILTER, polygonAreaM2, pointInRing. Testi: test_geometry/gpsfilter.
- `session.js` — Session: track, strips + **stripMeta** (odmerek/trak), coveredHa,
  fuelL, abLine. addFix(fix, active, width, flow, implPt, latOff, fuelLh).
- `constants.js` — OPERATIONS (+ transport noPaint), MACHINES (+ defaultOp), GUIDANCE, DEFAULTS.
- `storage.js` — IndexedDB **v3**: parcels, sessions, kv, gerklib, layers.
- `ble.js` / `offline.js` — Web Bluetooth klient / tile predprenos.
- `firmware/src/main.cpp` — ESP32: NimBLE **1.4** (ne 2.x!), sejalnica binarni RS485
  sniffer (poslušalec, DE trajno LOW), rate cmd, CAN/J1939 za `-D CAN_ENABLED`.
  `sejalnica_proto.h` = kopija sejalnica `shared/rs485_proto.h`.

## Ključne funkcije po verzijah (kratko)
- v3.x: AB vodenje+lightbar, prejšnja pokritost, sezona/CSV evidenca, sejalnica RS485.
- v4.0: MapLibre 2D/3D teren; GERK (gerk_extract.py + Action + gumb).
- v4.3–4.5: Google Maps follow (drag izklopi centriranje, NE beleženja!); heatmap
  intenzivnosti + drive črta + opozorilo prekrivanja; 3 načini (prosta karta /
  manual DELA-STOJI / Prevoz noPaint).
- v4.6: HUD (tekst čez mapo, brez okvirjev), glavna tipka DELA/STOJI; custom
  operacije+stroji, statistika strojev (ure/efektivne/ha/km/stroški).
- v5.0: geometrija priključka (extL/extR/backM/trailed + SVG editor); sloji+
  predpisne karte (rx → HUD cilj + BLE rate); ISOBUS/CAN priprava; popravljanje sej.
- v5.1: izvoz poročila parcele + analiza narisanega območja (količine po operacijah).
- v5.2: stroj primaren (→ privzeti defaultOp), dolg pritisk (op/stroj=nastavitve, parcela=karta).

## GERK dostop (POMEMBNO, glej memory gerk_dostop)
- Uradni javni izvoz (208 MB) **NIMA KMG_MID** → pripadnost dobimo iz javnega
  pregledovalnika (GWT-RPC replika v gerk_extract.py: getKMGInfo + WFS GERK_SDO;
  gwt_long encoder; hash-a vezana na viewer 3.2.4). DBF = cp1250.
- CORS povsod zaprt → veriga: `tools/gerk_config.json` (kmg_mid) → Action
  `gerk-data.yml` → `data/gerk-obmocje.geojson` na Pages → gumb "Prenesi po MID-u".
- Uporabnikov MID 100220160: 17 GERK-ov, 28,31 ha.

## Testiranje (OBVEZNO pred deployem)
- `node --check` na spremenjene .js; `node tests/test_*.mjs`.
- Vizualni/E2E: **chromium prek playwright-core** (headless FF ne izriše MapLibre WebGL!).
  Skripte v scratchpadu; server `python3 -m http.server PORT`. **Vedno NOV port** —
  Firefox/Chromium agresivno cache-a ES module med porti.
- `window._app` = debug hook (state, gps, ble, startSession, stopSession, _dbg).
- Firmware: `~/.platformio/penv/bin/pio run -e esp32dev` (+ CAN: `PLATFORMIO_BUILD_FLAGS="-D CAN_ENABLED=1"`).

## ODPRTE NALOGE (glej memory agrotracker_todo)
1. **RS485 TX na bus** za predpisne karte (variabilni odmerek dejansko krmili
   sejalnico) — čaka teren; rabi TX modula + varen okvir v sejalnica firmware.
2. **ISOBUS/CAN** test na pravem traktorju (transceiver SN65HVD230, CAN_ENABLED).
3. Terenski test z RTK (geometrija priključka pride do izraza).

(v5.2.1 zaključil grafiko predogleda stroja — machinePreviewSvg: traktor+priklop,
kotirne črte, pravilna orientacija, vejica v vnosu, simetrični fallback iz width.)

## Komunikacija
Slovenščina, sproščeno, inženirsko ozadje. Kratki odgovori, konkretni naslednji
koraki. Ne pojasnjuj osnov. Glej AGENTS.md za standarde kode.
