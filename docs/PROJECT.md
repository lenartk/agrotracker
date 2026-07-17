# AgroTracker — projekt

Sledenje obdelanim površinam na kmetiji. PWA (telefon + PC), ESP32 modul na stroju, GPS + BLE + RS485.

**Verzija:** v5.0 (julij 2026)
**Repo:** `github.com/lenartk/agrotracker`
**Live:** `https://lenartk.github.io/agrotracker/`
**Status:** v3.1 deployed na GitHub Pages — terenski test v teku (GPS potrjen, drift odpravljen z glajenjem)

---

## Hitri pregled

```
TELEFON (PWA)              ESP32 MODUL                STROJ
------------              -----------                -----
karta + UI       ←─BLE─→   GPS (NEO-8M)
shranjevanje              telemetrija       ←─RS485─→ ventil/lijak/boben
zgodovina                 (po želji SD log)            senzorji
izvoz/uvoz
```

**Telefon je terminal in pregled, ESP32 zbira podatke iz stroja, RS485 je standardni industrijski povezovalni kanal.**

---

## Kaj je narejeno (april 2026)

### PWA (frontend)

- ✅ Fullscreen karta (Leaflet, satelit + OSM)
- ✅ Tipi opravil (setev, gnojevka, mineralno gnojilo, škropljenje, košnja, spravilo, drugo) — vsako z barvo in enoto
- ✅ Stroji (sejalnica, cisterna, trosilec, škropilnica, kosilnica, nakladalna, kombajn) z delovnimi širinami
- ✅ Pravi telefonski GPS (`navigator.geolocation`)
- ✅ Web Bluetooth povezava na ESP32
- ✅ Simulacijski način (vlečenje s prstom za testiranje doma)
- ✅ Risanje pasov pokritja po širini stroja
- ✅ Avtomatska izbira parcele po GPS-u
- ✅ Auto-save sej v IndexedDB (vsakih 8 sekund)
- ✅ Pavza / nadaljuj / shrani
- ✅ Zgodovina sej z metrikami (ha, čas, prevoženo, prehodi)
- ✅ Uvoz GeoJSON parcel (FeatureCollection ali Feature)
- ✅ Izvoz seje kot GeoJSON
- ✅ Izvoz vseh sej skupaj (backup)
- ✅ Status pill-i (GPS / BLE / Online-Offline)
- ✅ Service worker — offline shell + tile cache
- ✅ Predprenos tile-ov za izbrane parcele (offline pripravljenost)
- ✅ Persistentno shranjevanje (`navigator.storage.persist()`)
- ✅ Slovenski jezik povsod
- ✅ Veliki gumbi za prste v rokavicah

### ESP32 firmware

- ✅ BLE GATT strežnik (NimBLE, custom service UUID)
- ✅ NEO-8M GPS preko UART2 + TinyGPSPlus
- ✅ RS485 line-protocol (`KEY:VALUE\n`) preko UART1
- ✅ JSON paketi: `tel` (telemetrija) + `gps` (fix)
- ✅ Bidirekcijska komunikacija (RX char za ukaze)
- ✅ SIM_MODE — fiktivni podatki za test brez strojne opreme
- ✅ Tri ciljne plošče: ESP32 WROOM-32, ESP32-S3, ESP32-C3

### Dokumentacija

- ✅ `docs/PROTOCOL.md` — BLE in RS485 specifikacija
- ✅ `docs/README.md` — quickstart in arhitektura
- ✅ `docs/PROJECT.md` — ta dokument

### Testirano

- ✅ Avtomatski Playwright test cele lifecycle
- ✅ Live deployment na GitHub Pages

---

## Trenutni status (julij 2026, v3.1)

**PWA**: v3.1 — AB vodenje z lightbarom (jedro AgriBus-NAVI), prejšnja pokritost,
sezona statistika, CSV evidenca, preostalo+ETA, nov industrijski UI, nove ikone.
**Upload**: v3.0 + v3.1 deployed na GitHub Pages (2026-07-16, git push prek SSH; klon v `~/workspace/agrotracker`)
**Test na terenu**: še NI — naslednji veliki korak (zdaj z vodenjem še bolj smiseln)
**ESP32 modul**: koda gotova, **strojna oprema še ni naročena/sestavljena**
**Cloud sync**: NI implementiran
**Desktop pregled**: NI specifičen layout (zaenkrat enak kot mobile)
**Popravljanje sej po fact**: NI

### v3.x na kratko (kaj je novega za uporabo)

1. Na karti pritisni `A·B` na začetku prve vožnje, pelji do konca, pritisni `→B`.
2. Lightbar pokaže odklon v cm in kam zaviti; linije so narisane na karti.
3. AB se zapomni na parceli — naslednjič se naloži sama.
4. Ob začetku dela vidiš zbledelo, kje si isto delo že opravil (prejšnje seje).
5. Domov: Sezona — koliko ha po opravilih letos. Nastavitve: Izvoz CSV za evidenco.

---

## Akcijski plan (kaj narediti pred naslednjo iteracijo)

### Pred prvim odhodom na teren

1. **Uvozi prave parcele**
   - Vir: [OPSI portal podatki.gov.si](https://podatki.gov.si/) → "GERK MKGP"
   - Pretvorba shapefile (.shp) → GeoJSON:
     - Online: [mapshaper.org](https://mapshaper.org) (naloži .shp set, izvozi GeoJSON, filtriraj svoje parcele)
     - CLI: `ogr2ogr -f GeoJSON moje.geojson gerk.shp -where "GERK_PID IN ('123', '456')"`
   - V PWA: Nastavitve → Uvozi GeoJSON

2. **Predprenesi tile-e**
   - Doma na WiFi: Nastavitve → Offline → "Predprenesi za parcele"
   - Pričakuj 7–50 MB glede na velikost parcel

3. **Preveri brezpovezavni način**
   - Zapri WiFi na telefonu, izklopi mobilne podatke
   - Odpri PWA — mora se zagnati, mora pokazati zemljevid
   - Online indikator v vrhu mora biti oranžen "Offline"

### Test na terenu (vrstni red, od najlažjega)

1. **Hoja okoli ene parcele**
   - GPS vir: Telefon
   - Operacija: "Drugo" (požanjeti vse, ne samo aktivne)
   - Začni sejo → sprehod po obrobju → Stop
   - Doma poglej Zgodovino: ali se vidi pas, ali je ha smiseln

2. **Vožnja s traktorjem brez ESP32 modula**
   - Operacija: dejanska (npr. košnja)
   - Stroj: dejanski (kosilnica)
   - Sim active = vedno (ker brez BLE pošiljatelja, ne ve, da kosi)
   - Poglej GPS točnost pri 10 km/h

3. **Test offline**
   - Poišči mesto brez signala (lahko v hiši v podzemlju, ali kakšna divjina)
   - Že imaš PWA odprto enkrat → cache je svež
   - Odpri ikono brez signala → karta + parcele morajo delati
   - Začni sejo → GPS dela (ne potrebuje signala)
   - Stop → preveri, da se shrani

4. **ESP32 modul (kasneje, ko ga imaš)**
   - Najprej s SIM_MODE doma — preveri BLE povezavo
   - Nato z NEO-8M ven, brez RS485 — preveri pravi GPS preko BLE
   - Nato z RS485 in dummy stroj — preveri active/width signal
   - Nazadnje montiraj na sejalnico

### Po vsakem testu

Napiši kratek dnevnik, kaj je delalo in kaj ne. Po teh izkušnjah se bomo odločili, kaj prioritetno naslednje implementirati.

---

## Struktura kode

```
agrotracker_v2/
├── index.html              # PWA shell, 4 pogledi: Home/Map/History/Settings
├── manifest.json           # PWA manifest
├── sw.js                   # Service worker (cache shell + tiles)
├── css/app.css             # Vsa stilska pravila
├── js/
│   ├── app.js              # Glavni kontroler (UI orkestracija)
│   ├── constants.js        # Operacije, stroji, BLE UUID-ji, defaultsi
│   ├── geo.js              # Razdalje, trakovi, ploščine, point-in-polygon
│   ├── storage.js          # IndexedDB wrapper (parcele, seje, nastavitve)
│   ├── ble.js              # Web Bluetooth klient
│   ├── gps.js              # GPS abstrakcija (phone/ble/sim viri)
│   ├── map.js              # Leaflet ovojnica, parcele, vozilo, trakovi
│   ├── session.js          # Življenjski cikel seje
│   └── offline.js          # Predprenos tile-ov, cache stat
├── data/demo-parcels.geojson
├── icons/
├── vendor/                 # Leaflet (lokalno za offline)
├── firmware/
│   ├── platformio.ini
│   └── src/main.cpp        # ESP32 firmware (BLE + GPS + RS485)
└── docs/
    ├── README.md
    ├── PROTOCOL.md
    └── PROJECT.md          # ta dokument
```

---

## Vizija: precizno kmetijstvo (v5+)

Aplikacija ima zdaj vse gradnike za pravo precizno kmetijstvo:

1. **Predpisne karte (prescription maps)**: uvoz con kot GeoJSON (analiza prsti,
   pridelek, N-senzor) s ciljnim odmerkom na cono. Telefon pozna pozicijo in cono →
   po BLE pošlje ciljni odmerek modulu → modul po RS485 sejalnici (protokol že
   ima setKgHa!). Stroj sam prilagaja količino po lokaciji. Zahteva: TX modula
   na bus (zdaj poslušalec) + varen "override rate" okvir v sejalnica firmware.
2. **Samodejni stop na že obdelanem**: ista pot (telefon že ve, kje je bilo
   delano — opozorilo obstaja od v4.4).
3. **ISOBUS/CAN branje** (traktor): ESP32 + CAN transceiver (~3 €) na
   diagnostičnem priključku → obrati motorja, dejanska poraba l/h, hitrost,
   moč → realna poraba na ha v statistiki strojev (zdaj ocena l/h × ure).
4. **Heatmap analiz prsti**: uvoz vzorčnih točk/con (pH, P, K, humus) kot sloj
   na karti — podlaga za predpisne karte.
5. **Letna poročila**: setvena struktura po GERK-ih, vnosi po parcelah (za
   dnevnik gnojenja / FADN / KOPOP evidence) — izvozi že nosijo GERK_PID.

## Roadmap — naslednji koraki, po prioriteti

### 🔴 Visoka prioriteta (preden gre v resno uporabo)

#### 1. Test na terenu

Brez tega vse ostalo gradi na predpostavkah.

- [ ] Uvoz pravih GERK parcel (iz OPSI)
- [ ] Vožnja peš s telefonom (najprej brez stroja)
- [ ] Vožnja s traktorjem brez ESP32 modula (telefon GPS + sim active)
- [ ] Test offline (predpreneseni tile-i, brez signala)
- [ ] Identificirati realne probleme (UX, GPS točnost, baterija…)

#### 2. Popravljanje sej po dejstvu

Ker GPS in stroj nista popolna, se nujno potrebuje urejanje:

- [ ] V Zgodovini → klikni sejo → tipka **"Uredi"**
- [ ] Prikaz cele seje na karti
- [ ] Brisalec (radius) za odstranitev pasov pokritja
- [ ] Risanje dodatnih pasov ročno ("tukaj sem dejansko sejal, GPS pa ni delal")
- [ ] Dodajanje opomb časovno ("zamenjava lijaka 14:25", "prazen seme 15:10")
- [ ] Recalculate ha po popravkih
- [ ] Undo / redo

#### 3. GPS interpolacija pri izpadu

- [ ] Detekcija timeout-a (>5 s brez fixa)
- [ ] Označi gap kot "GPS izgubljen"
- [ ] Po vrnitvi: ne riši čez gap (pusti za ročno popravljanje)
- [ ] V history: rdeča/svetlo barva za "interpolirano" / "negotovo" območje
- [ ] Ne vključuj v ha izračun, dokler ni potrjen

### 🟡 Srednja prioriteta (kvalitativni preskok)

#### 4. Desktop pregled

Za PC, ko prideš domov in greš pregledat zgodovino:

- [ ] Detekcija širine zaslona (responsive layout)
- [ ] Splitscreen: zemljevid 75% + panel z zgodovino 25%
- [ ] Več sej hkrati prekrivati na karto (za primerjavo med leti)
- [ ] Tabela sej s sortiranjem in filtriranjem (po datumu, stroju, parceli, opravilu)
- [ ] Skupne statistike: ha letno po opravilih, prevoženo skupaj
- [ ] Heatmap: kje letošnji največkrat sejal/gnojil
- [ ] Časovnica (slider) za pregled "kako sem vozil"

#### 5. ESP32 SD logger (uvoz po dejstvu)

Profesionalni pristop — modul logira na microSD kartico, telefon ni nujen za beleženje. Telefon je nice-to-have za real-time pregled, SD je primarni vir resnice.

**Razlogi:**
- Ne odvisnost od telefona med delom (baterija, BLE, ekran preveč svetel/temen)
- Telefon lahko v hiši ali kje drugje, modul še vedno beleži
- Zanesljiv: SD kartica zdrži vse vožnje
- Hitra rešitev za test, če BLE odpove

**Kaj implementirati:**

V firmware (ESP32):

- [ ] microSD modul preko SPI (3 €)
- [ ] `SD.h` knjižnica (vključena v Arduino-ESP32)
- [ ] CSV format: `timestamp,lat,lng,spd,hdg,sats,active,width,flow`
- [ ] Avtomatska rotacija datotek po datumu: `/agro/2026-04-26.csv`
- [ ] Append-only zapisovanje (manj možnosti za korupcijo ob izpadu napajanja)
- [ ] Hkrati BLE → telefon, **če je povezan**

V PWA:

- [ ] Tipka v Nastavitvah / Zgodovini "Uvozi sejo iz CSV"
- [ ] File picker za CSV/JSON
- [ ] Parser, ki rekonstruira sejo retroaktivno
- [ ] Možnost dodati operacijo, stroj, parcelo, opombe naknadno
- [ ] Generacija pasov pokritja iz GPS točk in zabeležene aktivnosti
- [ ] Izračun ha, dolžine, časa

**Hibrid način (priporočam):**

```
Modul vedno beleži na SD.
Modul hkrati pošilja BLE, če telefon poveže.

Telefon prikazuje real-time, če BLE deluje.
Po koncu dela:
  - Če telefon je vse pohodil: SD kartica je rezerva.
  - Če BLE odpove sredi vožnje: vzemi SD ven, uvozi sejo retroaktivno.
  - Če pozabiš telefon: SD kartica ima vse podatke.
```

**Cena:** ~3 € (SD modul) + 5–10 € (kartica) = ~10 € dodatnih stroškov za zelo močan zaščitni sloj.

#### 6. Cloud sync

Več opcij. Verjetno bomo implementirali eno za začetek, kasneje dodali še.

**Najmanj dela, dober začetek:**

- [ ] **A. Google Drive** — uporabnik se prijavi z Google računom, GeoJSON-i se shranjujejo v `MyDrive/AgroTracker/`. Pristop: OAuth 2.0 PKCE flow + Drive REST API. **1–2 dneva dela.**
- [ ] **B. Dropbox** — podobno kot Drive, OAuth manj kompliciran, 2 GB brezplačno
- [ ] **C. OneDrive** — če je v družini Office 365, najlažja integracija, 5 GB brezplačno

**Za podatkovno suverenost:**

- [ ] **D. WebDAV / Nextcloud** — če ima kmetija lasten Nextcloud na Pi-ju, pošilja direktno tja. Brez tretjih oseb. Najpoštenejše.

**Bizarna, a delujoča možnost:**

- [ ] **E. GitHub kot backend** — vsaka seja = en commit v privatnem repotu. Brezplačno, versionirano, dostopno z vsake naprave. Slabost: API rate limiti, nerodno za neprogrammerja.

**Lokalna sinhronizacija:**

- [ ] **F. WiFi sync z domačim Pi-jem** — ko prideš domov, telefon zazna domače WiFi → push v lokalni REST API. Brez interneta.
- [ ] **G. CRDT (Yjs/Automerge) — peer-to-peer** — naprave se sinhronizirajo med seboj, brez strežnika. Tehnično sofisticirano, prečudovita za multi-device kmetije.

**Skupne lastnosti, ki jih potrebujemo:**

- [ ] Queue za offline → push, ko je online
- [ ] Indikator zadnje uspešne sinhronizacije
- [ ] Conflict resolution (kaj če sem isti objekt urejal na dveh napravah)
- [ ] Selective sync (ne vse seje, samo zadnji teden, na primer)

**Pomembna ugotovitev:** APK ne reši cloud sync-a. APK je samo ovojnica okoli iste PWA kode. Cloud sync je ločena implementacija, ki velja za oba.

#### 7. PDF poročila

Za AKTRP / lastno evidenco:

- [ ] Tipka v Zgodovini "Izvozi PDF"
- [ ] A4 format z logom kmetije
- [ ] Karta seje + statistika + opombe
- [ ] Več sej združenih za sezonsko poročilo
- [ ] Slovenski formati datumov, decimalk

### 🟢 Nizka prioriteta (lepo imeti)

#### 8. ARSO vreme

- [ ] Integracija ARSO API
- [ ] Trenutno vreme v home view
- [ ] Opozorila pred padavinami / točo
- [ ] 24-urna napoved nad zemljevidom

#### 9. Foto pinning

- [ ] Tap dolgo na karti → odpre kamero
- [ ] Foto se shrani z GPS koordinatami in časom
- [ ] V Zgodovini "fotografije po opravilu"
- [ ] Uporabno za škodo divjadi, posebnosti na njivi

#### 10. Voice commands

- [ ] Web Speech API
- [ ] "Začni setev na njivi pri gozdu"
- [ ] "Pavza"
- [ ] Slovenščina (Web Speech jo zna)

#### 11. Glasovne objave

- [ ] Speech synthesis
- [ ] Ko prevoziš novih 0.1 ha → "ena desetinka hektarja"
- [ ] Opozorilo, če se peljejo izven parcele
- [ ] Brez gledanja v zaslon

#### 12. Auto-AKTRP poročila

- [ ] Združevanje sej v sezonske podatke
- [ ] Generacija setvene strukture (kateri pridelek na kateri parceli)
- [ ] Aplicirane gnojevke / gnojila / škropiva po parceli
- [ ] Izvoz v MKGP-jev format

#### 13. Senzorji vlage tal (LoRa)

- [ ] Branje LoRa senzorjev preko BLE-LoRa gateway-ja na ESP32
- [ ] Prikaz na karti (heatmap vlage)
- [ ] Opozorila ("parcela X — sušni stres")

#### 18. SMS / GSM obveščanje

Nov scenarij: ESP32 z dodatnim GSM modulom (SIM800 / SIM7600) lahko v primeru napake pošlje SMS, tudi če nisi blizu.

- [ ] GSM modul priklopljen na ESP32
- [ ] Konfigurabilna telefonska številka v firmware-u
- [ ] Trigger: stroj javi error, ali ni aktivnosti X minut, ali baterija pada
- [ ] Format: kratek SMS s koordinatami in razlogom
- [ ] **Pretirano za večino primerov**, zanimivo za posebne situacije (npr. kmetija ima sedem stojišč, ne moreš biti povsod)

#### 19. Vremenski pregled (ARSO)

- [ ] Integracija ARSO API
- [ ] Trenutno vreme v Home view
- [ ] Opozorila pred padavinami / točo
- [ ] 24-urna napoved nad zemljevidom
- [ ] Radarska slika padavin za Slovenijo

#### 20. Multi-uporabnik / večkratnik

Če bo več ljudi delalo na isti kmetiji (delavci, sosed, najemnik):

- [ ] Različne barve za različne uporabnike
- [ ] Auth (zelo enostavna — prijava preko Google ali kar uporabniško ime)
- [ ] Pravice (kdo lahko ureja parcele, kdo samo dela)
- [ ] Real-time pregled "kje so vsi traktorji" (rabi backend)

### 🔵 Daleč v prihodnosti / morda nikoli

#### 14. RTK natančnost

- [ ] NTRIP klient na ESP32-u
- [ ] Slovenski [SIGNAL omrežje](https://www.gu-signal.si)
- [ ] Sub-decimetrska natančnost

#### 15. ISOBUS

- [ ] CAN-bus communication s standardnimi kmetijskimi priklopniki
- [ ] Avtomatska kontrola sekcij (section control)
- [ ] Variable rate aplikacija
- [ ] Veliko dela, daleč od hobby projekta

#### 16. Auto-steering

- [ ] Motor v volanu, drag pillar
- [ ] Path following algoritem
- [ ] Verjetno nikoli, ker zahteva strojno-tehnično angažiranje

#### 17. iPhone podpora

Apple Safari **ne podpira Web Bluetooth** in po Apple App Store pravilih morajo vsi browserji na iOS-u uporabljati WebKit (Safari engine), zato niti Chrome/Firefox na iPhonu ne moreta dodati BLE podpore.

**Tri praktične poti:**

- [ ] **A. Bluefy browser** — specializiran iOS browser z lastnim BLE stackom. Naloži iz App Store, odpre AgroTracker URL v njem. Deluje, ampak UX je slabši (ne moreš dodati app na home screen kot pravo aplikacijo, vsakič moraš odpreti Bluefy najprej).

- [ ] **B. Capacitor wrapper** — vzameš obstoječo PWA, jo zaviješ v native iOS app preko [Capacitor](https://capacitorjs.com) framework-a, ki ima native BLE plugin. Zahteva:
  - Mac za Xcode
  - Apple Developer account ($99/leto)
  - App Store ali TestFlight distribucija (TestFlight do 100 uporabnikov, brezplačno)

- [ ] **C. Sprejmi, da iPhone uporabniki nimajo BLE** — uporabljajo PWA samo s telefonskim GPS-om, brez podatkov iz stroja. Pri kmetijah, kjer je 90 % Android, je to pragmatično.

**Trenutna odločitev:** **C**. Če pride iPhone uporabnik, mu pokažemo Bluefy. Native iOS dev je projekt zase, ne vredno, dokler nimamo realnih iPhone uporabnikov.

---

## Pomembne arhitekturne odločitve

### Zakaj PWA in ne native APK?

- Posodobitve trenutne (push v GitHub, naslednji odprtek vidi novo verzijo)
- Distribucija prek URL-ja (deli s sosedi z linkom)
- Ena koda za Android, iOS, PC desktop
- Brez Play Store administracije
- APK kasneje, če bo treba, **brez dodatnega dela** (PWA Builder zavije iste PWA v APK)

### Zakaj IndexedDB in ne SQLite?

- IndexedDB je standard v vseh brskalnikih, ne potrebuje WebAssembly
- Asinhrono, ne blokira UI
- Dovolj za naše potrebe (tisoči sej brez problema)
- Če bi prišlo do ozkega grla — sql.js (SQLite v WASM) je realna pot

### Zakaj Leaflet in ne Mapbox / MapLibre?

- Leaflet je preprost, hiter, dela na vsakem brskalniku
- Mapbox zahteva token in plačuje po uporabi
- MapLibre je odprta verzija Mapbox-a — uporabna, če bomo nekoč prešli na vektorske tile-e
- Trenutno raster tile-i (PNG) iz OSM/ArcGIS so dovolj

### Zakaj BLE in ne klasični Bluetooth (SPP)?

- Web Bluetooth podpira samo BLE, ne SPP
- BLE je manj porabe, primerno za senzorje
- Klasični Bluetooth bi zahteval native APK

### Zakaj RS485 med stroj in ESP32?

- Standard v industriji
- Long-range (do 1200 m), odporen na hrupna okolja
- Half-duplex enostaven s tekstovnim protokolom
- Preprost MAX485 driver, 3 €

### Zakaj line-protocol (`KEY:VALUE\n`) in ne Modbus?

- Branje in pisanje na PLC-ju je trivialno
- Ni odvisnosti od Modbus knjižnice
- Lahko se debugira s serial monitorjem
- Modbus bi bil bolj pravilen za multi-device, ampak zaenkrat ima en stroj en modul

---

## Primerjava z obstoječimi rešitvami

### Komercialni terminali (John Deere GreenStar, Trimble GFX-750, Topcon X35)

| Lastnost | Komercialni | AgroTracker |
|----------|-------------|-------------|
| Cena | 5.000 – 15.000 € | 0 € (telefon) + 30 € (ESP32 modul) |
| Naročnina | 500 – 1.500 €/leto | 0 |
| RTK natančnost | 2 cm vključeno | možno preko SIGNAL |
| Auto-steering | da | ne |
| ISOBUS | da | ne |
| Cloud sync | vključen | TODO |
| Berljivost na soncu | odlična | povprečna (telefon) |
| Razširljivost | zaprt sistem | popolna kontrola kode |
| Slovenske GERK parcele | ročno | direkten uvoz |
| Offline | da | da |

### Telefon-app rešitve (FieldView, FarmLogs, Ekonet, Agritronik)

| Lastnost | Komercialne app | AgroTracker |
|----------|-----------------|-------------|
| Cena | 0 – 200 €/leto | 0 |
| Število parcel (free) | 5 – 20 | neomejeno |
| Izvoz podatkov | omejen | popoln |
| Cloud sync | da | TODO |
| ESP32 / custom hardware | ne | da |
| GERK parcele | nekateri | da |
| Lastništvo podatkov | njihov cloud | tvoj cloud / lokalno |
| Razširljivost | ne | ja |

### Realno

**AgroTracker po implementaciji srednje-prioritetnih funkcij** (cloud sync, popravljanje, desktop pregled, SD logger):

- Funkcionalno **presega FieldView/FarmLogs free verzije**
- Doseže **~70 % John Deere GreenStar funkcionalnosti**
- Brez 10.000 € investicije
- Z vmesnikom v slovenščini in slovenske GERK parcele
- Razširljivo (lahko dodaš senzorje, posebne stroje, posebne formate poročil)

**Česar verjetno nikoli ne bo imel:**
- ISOBUS native (drag stack)
- Auto-steering (zahteva motor v volanu)
- Trgovska podpora (sam si support)
- Garancija delovanja pri ekstremnih pogojih (telefon ni industrijski)

---

## Zgodovina razvoja

### v1 (april 2026, prejšnji mesec)
- En `index.html`, samostojna PWA
- Samo simulacija vožnje
- Brez shranjevanja
- Brez BLE

### v2.0 (april 2026)
- Reorganizacija v ES module
- Pravi GPS, BLE klient
- IndexedDB shranjevanje, zgodovina, izvoz
- 7 tipov operacij, 7 strojev
- ESP32 firmware
- Service worker, offline shell

### v2.1 (april 2026)
- Predprenos tile-ov za offline parcele
- Online/Offline indikator
- Backup vseh sej
- Project documentation

### v2.2 (april 2026)
- Razširjena dokumentacija po debati o cloud sync, iPhone, SD logger-ju
- Dodatne ideje: SMS, ARSO, multi-user, foto pinning, voice
- Akcijski plan za prvi terenski test

---

## Vprašanja za naprej

Stvari, na katere se boš moral odločiti, ko prideš tja:

1. **Ali iPhone uporabniki resno bodo?** Če da → razmisli o Capacitor wrapperju.
2. **Cloud sync — kateri provider?** Google Drive za večino, lasten Nextcloud za "podatkovno suverenost".
3. **Bo več strojev hkrati?** Trenutno en BLE = en stroj. Za več hkrati potrebuješ različne UUID-je / imena ali mesh.
4. **Ali boš začel zaposlovati / sodelovati z drugimi?** Če da → potrebuješ multi-tenant, user management, pravice.
5. **Kako boš plačal RTK?** SIGNAL omrežje je ~150 €/leto za en uporabnik. Za 1 cm natančnost je vredno; za 50 cm (EGNOS) je brezplačno in dovolj za večino.

---

## Kontakt / nadaljnji razvoj

Ta projekt je v aktivnem razvoju, vodi ga lastnik kmetije (lenartk).

Naslednje korak bom uskladil glede na realne izkušnje s terena.
