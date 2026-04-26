# Agent navodila za AgroTracker

Ta datoteka je za AI agente in nove sodelavce. Človeški dokumentaciji se posveti `docs/PROJECT.md` in `docs/README.md`.

## Najprej preberi

V tem vrstnem redu:

1. **`docs/PROJECT.md`** — celoten projektni dokument: arhitektura, status, roadmap, akcijski plan, zgodovina. Začni tu.
2. **`docs/CHANGELOG.md`** — kaj se je spreminjalo od katere verzije.
3. **`docs/PROTOCOL.md`** — BLE in RS485 protokol med PWA in ESP32.
4. **`docs/README.md`** — hitri zagon in struktura.

Šele potem se loti kode.

## Kontekst projekta v eni minuti

- **Lastnik:** kmet v Sloveniji (kraška regija, 700 m, dairy + sirarna), tehnično podkovan, dela embedded projekte (sejalnica, kontrola hladilnika za mleko).
- **Cilj:** PWA za sledenje obdelanim površinam — telefon je terminal, ESP32 modul na stroju pošilja podatke preko BLE, RS485 do stroja.
- **Komunikacija:** **slovenščina** (uporabnik, dokumenti, UI, komentarji v kodi). Tehnične izraze (ES module, IndexedDB, BLE) puščamo v angleščini.
- **Ton:** sproščeno, brez korporativnega blebetanja. Praktično, izkušeno, brez patroniziranja. Uporabnik je odrasel inženir.

## Kako uporabnik dela

- Razvoj **iterativno**, glede na realne izkušnje s terena.
- Posodobitve preko GitHub Pages (`https://lenartk.github.io/agrotracker/`).
- Trenutno **brez git CLI** na uporabnikovem PC-ju, posodablja preko GitHub web vmesnika (drag & drop upload).
- Že nameščena PWA na telefonu — pomembno: ko sprememba SW vpliva, **zviša `APP_CACHE` verzijo** v `sw.js`, da telefon pobere update.

## Tehnični stack — fiksne odločitve

Te stvari so **odločene, ne predlagaj sprememb brez utemeljitve:**

- **PWA, ne native APK.** Razlogi v `docs/PROJECT.md` (Arhitekturne odločitve).
- **ES moduli**, brez bundler-ja (Vite, Webpack), brez TypeScript-a. Direktno `<script type="module">`.
- **IndexedDB**, ne LocalStorage / SQLite WASM.
- **Leaflet 1.9.4** lokalno v `vendor/`, ne CDN, ne Mapbox / MapLibre.
- **NimBLE** stack na ESP32, ne klasični Arduino BLE.
- **RS485 line-protocol** (`KEY:VALUE\n`), ne Modbus.
- **Slovenščina** v UI in komentarjih.
- **Brez frameworkov** za UI (React/Vue/Svelte). Vanilla DOM manipulacija.

## Standardi kode

### JavaScript

- ES modules (`import` / `export`).
- Async/await, ne `.then()` chain-i, razen kjer je to bolj berljivo.
- Imena: `camelCase` za spremenljivke in funkcije, `PascalCase` za razrede, `UPPER_SNAKE` za konstante.
- Komentarji v slovenščini, kjer pomagajo razumevanju, ne za vsako trivialno vrstico.
- **Error handling**: `try/catch` okoli I/O (IndexedDB, fetch, BLE), nikoli pri sintetičnih napakah.

### CSS

- En sam fajl `css/app.css` (zaenkrat).
- CSS variables v `:root` za barve, radije, sence.
- **Brez `<style>` blokov v HTML-u.**
- Mobile-first, desktop layout pride kasneje.

### HTML

- Semantičen, vsak element naj ima smisel.
- ID-ji za JS reference (`getElementById`), razredi za stilizacijo.
- Brez inline stylov, razen za dinamične vrednosti (npr. `style="width:${pct}%"`).

### ESP32 (firmware)

- Arduino + PlatformIO.
- C++, en sam `main.cpp` (zaenkrat).
- ArduinoJson za JSON, NimBLE za BLE, TinyGPSPlus za GPS.
- Pinout v komentarjih na vrhu.

## Testiranje

- **Smoke test** v `playwright`: glej zgodovino conversation-a, kjer sem že delal teste. Vsaka pomembna sprememba potrebuje regresijski test.
- **Sintaksa**: `node --check` za vsak `.js` modul.
- **JSON validnost**: `python3 -c "import json; json.load(open('...'))"`.
- **Lokalno serviranje**: `python3 -m http.server 8765 --bind 127.0.0.1`.

Preden potrdiš spremembo, **vsaj `node --check` na vsako spremenjeno JS datoteko**.

## Pasti, na katere pazi

### 1. Service worker cache

- Ko spremeniš seznam fajlov v `sw.js`, **zvišaj `APP_CACHE` verzijo** (`'agrotracker-app-v3'` → `'v4'`), da nameščene PWA pobereju spremembo.
- Uporabniki z že nameščeno PWA imajo cache; ne pričakuj, da pri njih takoj dela "novo".

### 2. Web Bluetooth zahteva HTTPS

- `localhost` velja kot varen origin (za dev).
- `file://` ne dela. Vedno preko strežnika.
- iOS Safari **ne podpira** Web Bluetooth — to je sprejeta omejitev, ne baga (glej `docs/PROJECT.md`).

### 3. GeoJSON koordinate

- GeoJSON je `[lng, lat]` (longitude prvi).
- Leaflet je `[lat, lng]` (latitude prvi).
- **Vedno bodi pozoren** ob pretvorbah. V `geo.js` so funkcije, ki obravnavajo to.

### 4. IndexedDB asinhron

- Vedno `await`. Ne pozabi `transaction(...)` lahko traje, dokler se izvajajo `await` znotraj.
- Pri kompleksnih operacijah razdeli na več transakcij.

### 5. ESP32 BLE MTU

- Default MTU je 23 (= 20 B payload).
- Po negotiation z modernim Android-om ~185 B.
- Paketi naj ne presegajo 180 B. Daljše zapise razbij na fragmente.

### 6. Tile cache je opaque

- ArcGIS satellite tile-i nimajo CORS header-jev.
- Fetch z `mode: 'no-cors'`.
- Service worker mora sprejeti `resp.type === 'opaque'` v cache.

## Brezpogojno NE delaj

- **Ne dodajaj telemetrije ali analitik** brez izrecnega dovoljenja uporabnika. Projekt je za zasebno uporabo, podatkovna suverenost je vrednota.
- **Ne uvozi paketov iz npm-a v PWA.** Vsa odvisnost je `vendor/leaflet.{js,css}`. Karkoli novega → razloži, zakaj, in dobi potrditev.
- **Ne brisuj / refaktoriziraj obstoječe kode brez razloga.** Inkrementalne spremembe.
- **Ne predlagaj framework migracij** (React/Vue). Glej fiksne odločitve.
- **Ne pošilji podatkov uporabnika nikamor** brez izrecne implementacije, o kateri smo se pogovorili.

## Ko končaš spremembo

1. **`node --check` vsako spremenjeno JS datoteko**
2. **Dodaj v `docs/CHANGELOG.md`** vnos v slogu obstoječih
3. **Posodobi `docs/PROJECT.md`**, če je sprememba pomembna (status, roadmap)
4. **Zviši verzijo SW**, če je sprememba PWA-ja
5. **Smoke test**, če je možno
6. **Commit message** v slogu obstoječih (kratek, slovensko, konkretno)
7. **Povzemi za uporabnika** — kaj je narejeno, kaj testirati, kateri korak naprej

## Trenutni status (april 2026)

- v2.2 deployed na GitHub Pages
- Prvi terenski test še ni izveden
- Naslednji koraki: terenski test → popravljanje sej → desktop pregled → cloud sync (vrstni red v `docs/PROJECT.md`)
- ESP32 strojna oprema še ni naročena/sestavljena

## Komunikacija z uporabnikom

- **Predpostavljaj inženirsko ozadje**, ne pojasnjuj osnov.
- **Ne piši predolgih odgovorov** — uporabnik nima časa brati eseje.
- **Ena stvar naenkrat** — če je v vprašanju več tem, odgovori jih posebej.
- **Konkretni naslednji koraki** na koncu odgovora.
- **Brez excessive bullet listov.** Slovenski govor je naraven, naj tudi koda komunicira tako.
