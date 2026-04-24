# AgroTracker v2

PWA za sledenje obdelanim površinam — telefon je zemljevid in terminal, ESP32 modul na stroju pošilja podatke.

---

## Sestava

```
agrotracker_pwa/              # PWA — postaviš na spletni strežnik (HTTPS) ali ji dostopaš z Android Chrome
├── index.html                # Shell z vsemi pogledi
├── manifest.json             # PWA manifest
├── sw.js                     # Service worker (offline cache, tile cache)
├── css/app.css
├── js/
│   ├── app.js                # Glavni kontroler
│   ├── constants.js          # Operacije, stroji, BLE UUID-ji
│   ├── geo.js                # Geodezija, trakovi, ploščine
│   ├── storage.js            # IndexedDB (parcele, seje, nastavitve)
│   ├── ble.js                # Web Bluetooth klient
│   ├── gps.js                # GPS vir (phone / BLE / sim)
│   ├── map.js                # Leaflet ovojnica
│   └── session.js            # Življenjski cikel seje
├── data/demo-parcels.geojson # Tri demo parcele v okolici Ljubljane
└── icons/                    # PWA ikone

firmware/                     # ESP32 firmware za BLE modul na stroju
├── platformio.ini
├── src/main.cpp
└── ...

docs/
├── PROTOCOL.md               # BLE in RS485 specifikacija
└── README.md                 # Ta dokument
```

---

## Kaj dela PWA v2 (primerjava z v1)

| Funkcija                     | v1 (tvoj sim) | v2 |
|------------------------------|---------------|----|
| Fullscreen karta + vozilo    | ✓             | ✓  |
| Ročna simulacija vožnje      | ✓             | ✓  |
| Barvanje po širini           | ✓             | ✓  |
| Izbor stroja/parcele         | ✓             | ✓  |
| **Pravi GPS (`navigator.geolocation`)** | ✗   | ✓ |
| **Web Bluetooth na ESP32**   | ✗             | ✓  |
| **Tipi operacij z lastno barvo/enoto** | ✗   | ✓ (setev/gnojevka/gnojilo/škrop./košnja/spravilo) |
| **"Aktiven" signal iz stroja** | ✗           | ✓  |
| **Shranjevanje v IndexedDB** | ✗             | ✓  |
| **Zgodovina sej**            | ✗             | ✓  |
| **Izvoz GeoJSON**            | ✗             | ✓  |
| **Uvoz GERK / GeoJSON**      | ✗             | ✓  |
| **Avtomatska izbira parcele po GPS** | ✗     | ✓  |
| **Pavza seje**               | ✗             | ✓  |
| **Auto-save** (varovalka pred crashom) | ✗     | ✓  |
| **Offline** (SW cache)       | delno         | ✓ (shell + tile cache) |
| **Status pills** (GPS/BLE)   | ✗             | ✓  |

---

## Hitri začetek

### A) Samo PWA, brez ESP32 (takoj za uporabo)

1. Postavi mapo z `index.html` na spletni strežnik z **HTTPS** (GPS in BLE zahtevata HTTPS oz. `localhost`).
   - Najhitreje: GitHub Pages, Netlify Drop, Cloudflare Pages, tvoj lastni Nginx.
   - Za lokalno testiranje v pisarni: `python3 -m http.server 8080` in dostop z drugega telefona preko localhost tunela, ali samo odpreš v Chrome na istem PC-ju (localhost velja kot varen origin).
2. Na telefonu (Android Chrome, iOS Safari) odpri URL.
3. Chrome menu → **Dodaj na začetni zaslon**.
4. Ko app odpreš, dovoli GPS.

### B) Z ESP32 modulom (BLE + RS485)

1. V `firmware/` odpri projekt v VS Code + PlatformIO.
2. Preveri pinout v `src/main.cpp`:
   - GPS NEO-8M: RX=GPIO16, TX=GPIO17, 9600 baud
   - RS485: RO=GPIO25, DI=GPIO26, DE/RE=GPIO27, 9600 baud
   - LED: GPIO2
3. `pio run -t upload` → naloži na ESP32 DevKit.
4. Če nimaš stroja še za test: v `platformio.ini` odkomentiraj `-D SIM_MODE=1`, firmware bo sam generiral fiktivne podatke.
5. V PWA odpri **Nastavitve → BLE povezava → Poveži**.
6. Po uspešni povezavi lahko v Nastavitve ali Meniju izbereš **GPS vir = ESP32 (BLE)**.

---

## Kaj še (predlogi za v3)

- **Union pokritja** — trenutno vsak trak šteje posebej k `ha`. Če dvakrat voziš čez isto mesto, se šteje dvakrat. Uvedba Turf.js-style `unionArea` bi dala pravo pokritost brez prekrivanj.
- **Rotacija karte po smeri vožnje** — map bearing rotacija, da imaš vedno "naprej = zgoraj".
- **Glasovni izpis** — "ha" vsakih 0.1 ha, "prekorači hitrost" ipd., brez gledanja v zaslon.
- **RTK / DGPS** — podpora za NTRIP klienta na ESP32 (SIGNAL mreža Geodetske uprave).
- **Večstrojno** — hkratno spremljanje več strojev; potrebna bi bila posebna BLE mesh topologija ali WiFi mesh.
- **Desktop pregled** — preprosta stran za odpiranje izvoženih GeoJSON-ov na PC-ju za pregled zgodovine.
- **Smerne linije** (A-B line, contour guidance) — v slogu John Deere / AgLeader terminalov.
- **Obrat na koncu vrstice** (headland management) — avtomatsko prekinjanje barvanja ob obratu.

---

## Znane omejitve

- **Web Bluetooth** deluje v Chrome/Edge na Androidu, macOS, Windows, Linux. **iOS Safari ga ne podpira** (to velja tudi za Chrome na iOS, ker mora v ozadju uporabiti WebKit). Edina pot za iOS je bodisi nativna aplikacija bodisi specializiran brskalnik tipa Bluefy (slabša UX).
- **GPS na iOS** zahteva reload po zavrnitvi dovoljenja (naloga brskalnika, ne aplikacije).
- **Tiles offline** — kar si si ogledal medtem ko si imel internet, se cache-a. Za popoln offline prenos parcel si poglej orodja kot `mbtiles` in custom tile server ali Mapbox Studio.

---

## Licenca / uporaba

Zasebna uporaba na kmetiji. Prosto za prirediti, razširiti, prebarvati.
