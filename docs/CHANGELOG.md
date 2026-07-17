# Changelog

Vse pomembnejše spremembe v projektu AgroTracker.

Format: [verzija] - YYYY-MM-DD

---

## [v4.6] - 2026-07-17

### Spremenjeno — čista karta (HUD) in glavna tipka stroja

- **Karta čez cel ekran**: okvirčki umaknjeni — hitrost/ha kot velike številke,
  parcela/stroj/statusi in spodnja statistika kot tekst z obrobo direktno čez
  mapo ("podnapisi"). Ostanejo samo meni, stranski gumbi in tri velike tipke.
- **STROJ DELA/STOJI je zdaj glavna tipka** (levo spodaj, največja): med sejo
  z njo ročno preklapljaš barvanje (brez BLE); z BLE kaže stanje iz stroja
  (DELA/MIRUJE/DVIGNJEN/ALARM). Pred sejo je ista tipka "Začni".

### Dodano — operacije in stroji po meri

- **Custom operacije**: Nastavitve → Operacije → Dodaj (ime, enota, barvanje
  ob aktivnem stroju ali samo pot). Uporabno za mulčenje, valjanje, karkoli.
- **Stroji z ekonomiko**: vsak stroj (tudi nov, npr. Avto) dobi delovno širino,
  lastno ceno €/h, porabo l/h, ceno goriva in storitveno ceno €/ha.
- **Statistika stroja** (tap na stroj): sej, ure, efektivne ure (dejansko delo),
  ha, km, povprečna delovna hitrost, storilnost ha/h, ocena goriva in stroškov,
  strošek €/ha, storitvena vrednost opravljenega dela.
- **Prevoz riše vidnejšo črto** v svoji barvi (dostava s strojem ali avtom —
  šteje km in ure).

### Tehnično

- `allOperations()/allMachines()` (vgrajeni + uporabniški), `appForm` dialog,
  `APP_CACHE` v15

---

## [v4.5] - 2026-07-17

### Dodano — trije jasni načini vožnje

1. **Prosta karta (brez beleženja)**: gumb "Odpri karto (brez beleženja)" na
   Domov — pregled parcel in pozicije, nič se ne zapisuje.
2. **Beleženje z delom**: kot doslej (pas pokritosti, ha, heatmap).
3. **Beleženje brez stroja / z ugasnjenim**:
   - **Ročno stikalo DELA/STOJI** — tap na ploščico "Stroj" na karti (ko ni
     BLE signala): STOJI = riše se samo tanka pot, ha se ne šteje. Za delo
     brez ESP32 modula.
   - Nova operacija **"Prevoz"** — cela seja samo pot (evidenca km/časa,
     brez pokritosti).

### Tehnično

- `OPERATIONS.transport` (noPaint), `session.shouldPaint` upošteva noPaint,
  `effectiveMachineActive` upošteva ročno stikalo; `APP_CACHE` v14

---

## [v4.4] - 2026-07-16

### Dodano — pot, heatmap intenzivnosti, opozorilo na prekrivanje

- **Tanka bela črta poti** se med sejo riše VEDNO — vidiš, kje si se samo vozil;
  obarvan pas ostaja samo tam, kjer je stroj dejansko delal.
- **Heatmap intenzivnosti**: barva pasu po poročanju stroja — dejanski odmerek
  proti nastavljenemu (sejalnica: actualKgHa/setKgHa). Svetleje = premalo,
  osnovna barva = točno, temneje = preveč. Brez telemetrije: enotna barva.
- **Opozorilo na prekrivanje**: ko z delujočim strojem zapelješ na že obdelano
  (ta seja ali prejšnje na isti parceli) → "Prekrivanje — tu si že delal"
  (+ pisk in vibracija, če je pisk vklopljen). Mreža ~4 m, sveža sled se ne šteje.
- Pojasnilo: premik karte NIKOLI ne prekine beleženja — ustavi se samo
  samodejno centriranje pogleda (gumb preimenovan v "Centriraj na vozilo").

### Roadmap

- **Strojni samodejni stop na že posejanem** (stroj bere pokritost): zahteva
  TX modula na RS485 bus (zdaj namerno samo poslušalec), nov tip okvirja in
  obravnavo v sejalnica firmware — načrtovano po prvem terenskem testu.

### Tehnično

- `APP_CACHE` v13

---

## [v4.3] - 2026-07-16

### Spremenjeno — Google Maps vedenje karte

- **Ročni premik karte izklopi sledenje vozilu** — karta ostane, kjer si jo
  pustil (pregledovanje parcel med sejo brez "vračanja" na lokacijo).
- **Križec** (en sam gumb) ponovno centrira na vozilo in vklopi sledenje;
  stanje sledenja je vidno (zelen gumb). Ločen ON/OFF gumb odstranjen.
- `APP_CACHE` v12

---

## [v4.2.1] - 2026-07-16

### Popravljeno — posodobitve na telefonu

- **Telefon je lahko "obtičal" na stari verziji**: če je SW install med
  10-minutnim CDN oknom GitHub Pages shranil staro vsebino, jo je cache-first
  strategija stregla večno (sw.js pa se ni več spremenil → ni update sprožilca).
  Shell se zdaj ob installu prenaša s `cache: 'reload'` (mimo HTTP/CDN cache).
- **Samodejna posodobitev**: ko novi SW prevzame nadzor, se stran sama osveži
  (toast "Posodobitev prenesena") — ročni "reseti" niso več potrebni.
- **Nastavitve → O aplikaciji**: prikaz dejansko nameščene verzije
  (predpomnilnik vN) + gumb **"Preveri posodobitev"**.
- `APP_CACHE` v11

---

## [v4.2] - 2026-07-16

### Dodano — samodejni uvoz GERK po KMG-MID

- **Gumb "Prenesi po MID-u (samodejno)"** v Nastavitvah: aplikacija potegne
  `data/gerk-obmocje.geojson` z lastnega origina in uvozi (parcele po MID +
  knjižnica). Brez ročnih datotek.
- **GitHub Action `gerk-data.yml`**: ob vpisu KMG-MID v `tools/gerk_config.json`
  (enkratno; tudi prek GitHub web vmesnika), mesečno in na ročni zagon
  prenese uradni javni izvoz MKGP (cache-iran), izlušči GERK-e območja in
  objavi datoteko na Pages. GitHub je edini "strežnik" — brez lastne infrastrukture.
- SW: generirana GERK datoteka se streže network-first (vedno sveža).

### Tehnično

- `APP_CACHE` v10

---

## [v4.1] - 2026-07-16

### Dodano — GERK knjižnica (MID → parcele, in obratno)

- **Nastavitve → KMG-MID + "Uvozi GERK območje"**: iz ene datoteke
  (`tools/gerk_extract.py <MID> --obmocje-km 5`) se tvoje parcele po KMG-MID
  vnesejo same, VSI GERK-i območja pa ostanejo v lokalni knjižnici (IndexedDB).
- **"Kontra smer": stojiš na parceli → app jo doda.** Ob začetku dela brez
  izbrane parcele app v knjižnici poišče GERK pod GPS pozicijo in ga ponudi
  ("Stojiš na: … Dodam med parcele?"). Ročno tudi prek menija
  ("Dodaj GERK tukaj"). Deluje offline, pokrije tudi najete parcele
  (drug KMG-MID). Brez strežnika — CORS na rkg.gov.si je zaprt (preverjeno
  vklj. preflight), zato podatki pridejo iz datoteke, logika pa je lokalna.

### Popravljeno

- **Počasno nalaganje karte ob začetku dela**: karta se zdaj ustvari in
  ogreje ob zagonu aplikacije (tile-i za parcele se predpomnijo takoj),
  raster prehodi brez bledenja (`fadeDuration: 0`).

### Tehnično

- IndexedDB shema v2 (nov store `gerklib`), `APP_CACHE` v9

---

## [v4.0] - 2026-07-16

### Dodano — 2D/3D karta (MapLibre GL)

- **Menjava zemljevidnega motorja Leaflet → MapLibre GL** (vendored, brez CDN).
  Razlog: pravi 3D pogled s terenom za hribovske parcele — Leaflet tega ne zmore.
  En motor pokriva obe opciji: gumb **3D** na karti preklopi teren (terrarium DEM,
  prosti AWS vir, brez ključa) + nagib kamere; 2D = klasičen top-down.
- Vsa logika ohranjena: parcele, pokritost (metrična širina črte tudi v 3D),
  AB vodenje, markerji, sledenje vozilu. DEM tile-i se predpomnijo v SW (offline).

### Dodano — GERK evidenca

- `tools/gerk_extract.py <KMG-MID>` — iz uradnega javnega izvoza MKGP (208 MB,
  prenese in cache-ira sam) izlušči GERK-e kmetije → GeoJSON za uvoz.
- Uvoz ohrani **GERK_PID in rabo**; samodejno zaznan GERK se zabeleži v sejo.
- Izvozi vsebujejo GERK_PID: CSV (stolpca gerk_pid, raba) in GeoJSON (track
  properties: gerkPid, kmgMid, operationId, flowTotal/unit, note) — evidenca
  je strojno uporabna v drugih programih (dnevnik gnojenja ipd.).
- Neposreden prenos GERK-ov v aplikaciji ni mogoč: javni strežniki ne pošiljajo
  CORS glav in ni javnega WFS (preverjeno) — zato skripta + uvoz.

### Spremenjeno — resnejši izgled (P1)

- **SVG ikone** (inline sprite) namesto emoji v vsem UI kromu in operacijah
- **Lastni potrditveni dialogi** namesto native confirm()/alert()
- **Decimalna vejica** (sl-SI) v vseh prikazih; izvozi ostajajo s piko (interop)
- **Dnevni način** — svetla visokokontrastna tema za sonce (preklop v meniju
  in nastavitvah, shranjeno)
- Vibracija ob nastavitvi A/B in ob alarmu odklona

### Tehnično

- `vendor/maplibre-gl.{js,css}` (5.6.0), leaflet odstranjen
- `APP_CACHE` v7 → **v8**; tile cache pokriva tudi DEM (elevation-tiles-prod)
- Firmware nespremenjen (v3.2)

---

## [v3.2] - 2026-07-16

### Dodano — združljivost s sejalnico

- Firmware zdaj razume **binarni RS485 protokol sejalnice** (`[0xAA][TIP][LEN][PAYLOAD][CRC8]`
  @ 57600) — modul se pasivno obesi na obstoječo linijo backend↔kabina, DE trajno LOW
  (busu nič ne pošilja, stroj brez tveganja). `firmware/src/sejalnica_proto.h`.
- Mapiranje: aktiven = valjček se vrti (actualRPM > 0.5) in ni dvignjena; širina iz
  kabininih nastavitev (workingWidthM); pretok = actualKgHa; alarmi kot bitmask.
  Barvanje pokritosti se ob dvigu na ozari samodejno ustavi.
- Nova telemetrijska polja: `lift`, `alarm`, `mspd` (hitrost stroja), `marea`
  (površina, ki jo šteje stroj), `set` (nastavljeni kg/ha).
- PWA: status stroja na karti — **SEJE / DVIGNJEN / ALARM / MIRUJE** (prej se
  polje "Stroj" ni nikoli polnilo).
- Generični `KEY:VALUE` protokol ohranjen (oba parserja sočasno).

### Popravljeno

- **Firmware se sploh ni prevedel** (pisan za NimBLE 2.x API ob pinu ^1.4.1 +
  manjkajoča forward deklaracija) — prilagojen na NimBLE 1.4, `pio run` zelen.
  Očitno nikoli zbuildan.
- Track: konci črte **odsekani** (lineCap butt), ovinki ostajajo zaobljeni.

### Tehnično

- `APP_CACHE` v6 → v7

---

## [v3.1] - 2026-07-16

### Popravljeno

- **Kritično: telefonov GPS se ni nikoli zagnal.** `GPSSource` konstruktor je imel
  `source = 'phone'`, guard v `setSource` pa je ob zagonu (in ob kliku "Telefon")
  zaradi "ni spremembe" preskočil `watchPosition`. Delala sta samo sim in BLE.
  Bug prisoten od v2.0. Zdaj se vir inicializira iz `null` in telefon GPS
  ob prvem zagonu pravilno vpraša za dovoljenje za lokacijo.
- **Ikoni preimenovani** v `icon-192-v3.png` / `icon-512-v3.png` (manifest, SW, apple-touch) —
  cache-busting, da nameščene PWA ob ponovni namestitvi dobijo novo ikono.
- `APP_CACHE` v5 → v6

### Dodano — GPS glajenje in zvezni track

- **GPS glajenje** (`geo.js: smoothPosition/smoothHeading`, žično v `gps.js`):
  fix z natančnostjo > 30 m zavržen, pri mirovanju pozicija primrznjena (ne "tava"),
  eksponentno glajenje pozicije prilagojeno hitrosti, krožno glajenje smeri.
  Odpravi drift, ki ga AgriBus-NAVI nima (oni filtrirajo — zdaj tudi mi).
  Parametri v `GPS_FILTER` (kalibracijski gumbi za teren).
- **Zvezni track kot poteg z markerjem**: pokritost se riše kot ena neprekinjena
  črta z zaobljenimi stiki (debelina = delovna širina v metrih, preračun ob zoomu)
  namesto ločenih štirikotnikov — brez šivov in "črtastega" videza.
  Podatkovni zapis (strips v seji, ha, izvozi) nespremenjen.
- `tests/test_gpsfilter.mjs` — self-check glajenja
- **Popravek lukenj v traku**: barvanje je prej pokrilo samo zadnji GPS segment
  (prev→fix), ne celotne poti od zadnjega vzorčenja — pri hitrejši vožnji so
  nastajale luknje ("črtast" trak) in ha je bil podcenjen. Zdaj strip in ha
  od zadnje barvane pozicije.

---

## [v3.0] - 2026-07-16

### Dodano — AB vodenje (jedro AgriBus-NAVI)

- `js/guidance.js` — AB linija, vzporedne vodilne linije na razmik delovne širine,
  cross-track error s predznakom glede na smer vožnje (obračanje na koncu njive upoštevano)
- **Lightbar** na vrhu karte: LED segmenti (rumena→oranžna→rdeča), velika številka odklona
  (cm/m), puščica kam zaviti, oznaka aktivne linije (AB / 2L / 3D, ↩ pri obrnjeni smeri)
- Gumb `A·B` v stranskih kontrolah: nastavi A → nastavi B → odstrani
- Vzporedne linije narisane na karti (aktivna oranžna, ostale bele črtkane)
- AB linija se shrani na parcelo — naslednja seja na isti parceli jo samodejno naloži
- AB linija shranjena tudi v sejo (`abLine` v GeoJSON izvozu podatkov seje)
- Zvočni pisk pri odklonu > 30 cm (Web Audio, toggle v meniju, privzeto izklopljen)
- `tests/test_guidance.mjs` — geometrijski self-check (node)

### Dodano — pokritost in evidenca

- **Prejšnja pokritost**: ob začetku seje se pokritost prejšnjih sej iste operacije
  na isti parceli pokaže kot zbledel sloj ("kje sem že bil")
- **Sezona** na domačem zaslonu: ha in število sej po operacijah za tekoče leto + skupaj
- **Filter po parceli** v Zgodovini + povzetek (sej / ha / čas)
- **Izvoz CSV (evidenca)** v Nastavitvah: vse seje s podpičjem ločene (slovenski Excel),
  UTF-8 BOM — datum, časi, operacija, stroj, parcela, ha, km, poraba, opomba
- **Preostalo ha + ocena časa (ETA)** med sejo (iz hitrosti in širine)
- Leaflet `preferCanvas` — hitrejše risanje več tisoč trakov

### Spremenjeno — celostni UI overhaul

- Industrijski temni stil (terminal na stroju): flat paneli, ostrejši robovi,
  močnejši kontrast, mono številke (instrument look), brez gradientov in steklastih efektov
- Nov logotip (SVG) in **novi PWA ikoni** (192/512): proge polja + AB linija
- Lightbar s kvadratnimi LED segmenti, večje številke
- Pretok prestavljen iz spodnjega panela v meni (nadomestita ga Preostalo + ETA)
- `manifest.json` in `theme-color` posodobljena na novo paleto

### Popravljeno

- **Kritično: `softFollow` je imel obrnjen predznak** (`panBy` premakne center, ne točke) —
  napaka se je vsak GPS fix podvojila in karta je eksponentno zbežala (v testu do južnega pola).
  Bug je bil prisoten že v v2.0, neopažen, ker terenski test še ni bil izveden.
- Vrnitev na Domov zdaj osveži prikaz (sezona statistika po shranjeni seji)

### Tehnično

- `APP_CACHE` v3 → **v5** (nameščene PWA ob naslednjem odprtju povlečejo novo verzijo)
- `js/guidance.js` dodan v SW shell

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
