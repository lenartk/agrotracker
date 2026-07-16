# AgroTracker — specifikacija protokola

Ta dokument opisuje pakete, ki se izmenjujejo med telefonom (PWA) in modulom ESP32, ter med ESP32 in strojem preko RS485.

---

## 1. BLE GATT

### Service UUID
`6b00a11e-1111-4a50-8000-000000000001`

### Karakteristike

| Ime      | UUID                                       | Tip          | Smer           | Opis |
|----------|--------------------------------------------|--------------|----------------|------|
| TX       | `...000000000002`                          | Notify, Read | ESP → telefon  | Telemetrija + GPS |
| RX       | `...000000000003`                          | Write, WriteNR | telefon → ESP | Ukazi |
| INFO     | `...000000000004`                          | Read         | telefon ← ESP  | Ime firmware-a, verzija |

### Paketi ESP → telefon (TX, notify)

En Notify = en UTF-8 JSON objekt. **Brez** newline-ov znotraj objekta.
MTU je 185 B (ESP32 zahteva po `setMTU(185)`). Sporočila naj ne presegajo 180 B.

Polje `t` (type) določa vrsto:

#### `tel` — telemetrija stroja (500 ms)
```json
{
  "t": "tel",
  "ms": 12345,
  "active": 1,
  "mach": "sejalnica",
  "w": 3.0,
  "rs485_ok": 1,
  "flow": 42.5
}
```

| Polje    | Tip   | Opis |
|----------|-------|------|
| `ms`     | uint  | ms od zagona modula (za diagnostiko) |
| `active` | 0/1   | Ali stroj trenutno dela (npr. ventil odprt / boben spuščen) |
| `mach`   | str   | Oznaka stroja |
| `w`      | float | Delovna širina v metrih |
| `rs485_ok` | 0/1 | Ali iz RS485 prihajajo sporočila |
| `flow`   | float | Neobvezen pretok (enota je odvisna od stroja) |

#### `gps` — GPS fix (500 ms)
```json
{
  "t": "gps",
  "lat": 46.0514,
  "lng": 14.5002,
  "spd": 7.2,
  "hdg": 145,
  "hdop": 0.9,
  "sats": 12,
  "alt": 335.2,
  "fix": 3
}
```

| Polje   | Tip   | Opis |
|---------|-------|------|
| `lat`, `lng` | float | Stopinje |
| `spd`   | float | km/h |
| `hdg`   | float | stopinj, 0–360 (sever = 0) |
| `hdop`  | float | Natančnost (nižje je bolje) |
| `sats`  | uint  | Št. satelitov |
| `alt`   | float | Nadmorska višina v m |
| `fix`   | 0/1/2/3 | 0=no, 1=GPS, 2=DGPS, 3=RTK-fix |

#### `pong` — odgovor na `ping`
```json
{"t": "pong", "ms": 12345}
```

### Paketi telefon → ESP (RX, write)

JSON objekt, `c` polje = ukaz.

#### `ping`
```json
{"c": "ping"}
```
Modul odgovori z `pong` paketom preko TX.

#### `sim` — postavljanje simuliranega stanja (za testiranje brez prave strojne opreme)
```json
{"c": "sim", "active": 1, "width": 3.0, "flow": 40}
```

#### `setname` — preimenuj stroj
```json
{"c": "setname", "name": "sejalnica-2"}
```

---

## 2. RS485 povezava stroj ↔ ESP32

Half-duplex, **9600 baud**, 8N1. MAX485 driver, DE/RE pin tied skupaj.

### Format: `KEY:VALUE\n`

Teksten line-based protokol, enostaven za implementacijo v katerem koli PLC-ju ali mikrokontrolerju na stroju.

| Ključ   | Vrednost | Primer            | Opis |
|---------|----------|-------------------|------|
| `ACTIVE` | 0 ali 1 | `ACTIVE:1\n`       | Ali stroj dela |
| `WIDTH`  | float   | `WIDTH:3.0\n`      | Trenutna delovna širina (m) |
| `FLOW`   | float   | `FLOW:42.5\n`      | Pretok (kg/min, l/min, ipd.) |
| `NAME`   | str     | `NAME:sejalnica\n` | Ime stroja |
| `SPEED`  | float   | `SPEED:7.3\n`      | Hitrost iz senzorja (km/h, neobvezno) |

Stroj lahko te vrstice pošilja s poljubno frekvenco (priporočeno 2–5 Hz).
Če 3 sekunde ni sporočila, ESP32 označi `rs485_ok = 0`.

### Primer minimalnega pošiljanja iz sejalnice

Arduino psevdokoda:
```cpp
if (seedValveOpen) Serial1.println("ACTIVE:1");
else               Serial1.println("ACTIVE:0");
Serial1.printf("WIDTH:%.1f\n", workWidth);
Serial1.printf("FLOW:%.1f\n", seedRate);
```

---

## 3. Življenjski cikel povezave

1. ESP32 po zagonu advertise-a service z imenom `AgroESP-...`
2. Telefon (PWA) klikne **Poveži** → `navigator.bluetooth.requestDevice` → filter po prefiksu imena
3. PWA se pretocha (subscribe) na TX char → dobiva telemetrijo in GPS
4. Po potrebi pošlje `ping` za preverjanje žive povezave
5. Ob prekinitvi: ESP32 avtomatsko ponovno advertise-a, PWA dobi `gattserverdisconnected` event

---

## 4. Razširitve (v2 in naprej)

Preprosto dodati:

- **Več strojev hkrati** — vsak ESP32 ima drugo ime (`AgroESP-01`, `AgroESP-02`), telefon se lahko poveže na enega. Za več sočasno je treba posebno obravnavo.
- **Večji JSON-i (presek MTU)** — uvesti fragmentacijo: `{"t":"ch","n":1,"of":3,"d":"..."}`
- **Binary protokol** — za boljšo učinkovitost, a se izgubi prozornost debuga
- **Ukazi proti stroju** — telefon → ESP → RS485: `{"c":"relay","id":"valve","on":1}` → ESP prebere in pošlje v RS485 `RELAY:valve:1\n`


---

## RS485 — SEJALNICA (binarni protokol, pasivno poslušanje)

Modul se obesi **paralelno na obstoječo RS485 linijo** med backendom
(`sejalnica_v332_rtos`) in kabino (`sejalnica_kabina_v279_rtos`):
A→A, B→B, GND→GND. **DE/RE je trajno LOW — modul busu nikoli ne piše**,
zato ne more zmotiti delovanja stroja.

- Baud: **57600 8N1**
- Frame: `[0xAA][TIP][LEN][PAYLOAD…][CRC8]`, CRC8 poly 0x31 init 0x00 čez TIP+LEN+PAYLOAD
- Structi: `firmware/src/sejalnica_proto.h` (kopija iz sejalnica repo `shared/rs485_proto.h`
  — ob spremembi žice v sejalnici posodobi oboje; LEN preverjanje + CRC ščitita
  pred napačno interpretacijo)

| Frame | Vir | Uporaba v modulu |
|---|---|---|
| 0x01 status (45 B) | backend → kabina | `active` = actualRPM > 0.5 && !isLifted; `flow` = actualKgHa; `lift`, `alarm` (bitmask), `mspd` = filteredSpeedKmh, `marea` = sessionAreaHa |
| 0x02 settings (57 B) | kabina → backend | `w` = workingWidthM; `set` = setKgHa |

Telemetrija (`tel`) dobi nova polja: `lift` (0/1), `alarm` (bit0 noSpeed, bit1 noRoller,
bit2 stalled, bit3 speedTooLow, bit4 invalidParams), `mspd`, `marea`, `set`.
PWA prikaže status stroja: **SEJE / DVIGNJEN / ALARM / MIRUJE**. Barvanje pokritosti
je vezano na `active` — pri dvigu na ozari se barvanje samodejno ustavi.

Generični tekstovni `KEY:VALUE\n` protokol še vedno deluje (oba parserja tečeta
sočasno na istem streamu) — za druge/prihodnje stroje.
