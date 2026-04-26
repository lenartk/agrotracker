# AgroTracker

PWA za sledenje obdelanim površinam na kmetiji. Telefon je terminal in zemljevid, ESP32 modul zbira podatke iz stroja preko BLE in RS485.

🌐 **Live:** https://lenartk.github.io/agrotracker/

## Hitri pregled

- **Telefon (Android Chrome)** + GPS = osnovno delovanje brez strojne opreme
- **+ ESP32 modul + RS485 + GPS** na stroju = popolno delovanje s pravimi podatki iz stroja
- **+ predpreneseni tile-i** = delovanje brez signala na hribu

## Funkcionalnosti

- 7 tipov opravil (setev, gnojevka, mineralno, škropljenje, košnja, spravilo, drugo) z lastnimi barvami
- 7 strojev z delovnimi širinami
- Avtomatska izbira parcele po GPS-u
- Risanje pasov pokritja po širini stroja
- Auto-save sej v IndexedDB (vsakih 8 sekund)
- Pavza / nadaljuj / shrani sejo
- Zgodovina sej z metrikami (ha, čas, prevoženo, prehodi)
- Uvoz/izvoz GeoJSON parcel
- Offline pripravljenost (predprenos tile-ov)
- Status indikatorji (GPS / BLE / Online)
- Service worker za offline shell

## Dokumentacija

Vse v mapi [`docs/`](./docs/):

- 📋 [**PROJECT.md**](./docs/PROJECT.md) — popoln opis projekta, roadmap, primerjava z obstoječimi rešitvami
- 🚀 [**README.md**](./docs/README.md) — quickstart navodila
- 📡 [**PROTOCOL.md**](./docs/PROTOCOL.md) — BLE in RS485 specifikacija
- 📝 [**CHANGELOG.md**](./docs/CHANGELOG.md) — zgodovina verzij

Za AI agente in nove sodelavce: glej [**AGENTS.md**](./AGENTS.md) v root mapi.

## Hitra namestitev na Android

1. Odpri https://lenartk.github.io/agrotracker/ v Chrome
2. Chrome menu → **Namesti aplikacijo**
3. Odpri ikono iz home screena

## Struktura

```
.
├── index.html              # PWA shell
├── manifest.json
├── sw.js                   # Service worker
├── css/                    # Stili
├── js/                     # ES moduli
├── vendor/                 # Leaflet lokalno
├── data/                   # Demo parcele
├── icons/                  # PWA ikone
├── firmware/               # ESP32 PlatformIO projekt
└── docs/                   # Dokumentacija
```

## Tehnologija

- **Frontend:** ES modules, Leaflet, IndexedDB, Web Bluetooth, navigator.geolocation
- **Service worker:** Cache-first za shell, tile cache za zemljevid
- **ESP32:** PlatformIO, NimBLE-Arduino, TinyGPSPlus, ArduinoJson
- **Hosting:** GitHub Pages (HTTPS, brezplačno)

## Licenca

Zasebna uporaba na kmetiji. Prosto za prirediti, razširiti, prebarvati po lastni izbiri.
