// AgroTracker ESP32 modul — firmware
// ====================================
//
// Funkcije:
//   1. BLE GATT strežnik (Nordic-like custom service).
//      Telefon se poveže in prejema telemetrijo (JSON) preko notify.
//   2. GPS (NEO-8M) preko UART2, NMEA parsanje s TinyGPSPlus.
//   3. RS485 na stroj preko UART1 (MAX485). Dva protokola hkrati:
//      a) SEJALNICA binarni frame [0xAA][TIP][LEN][PAYLOAD][CRC8] @ 57600 —
//         modul se PASIVNO obesi na obstoječo linijo backend<->kabina
//         (DE trajno LOW, busu nič ne pošilja). Glej sejalnica_proto.h.
//      b) generični tekstovni KEY:VALUE\n (ACTIVE:1, WIDTH:3.0, FLOW:42.5)
//         za druge/prihodnje stroje.
//   4. Periodično (2 Hz) pošlje JSON paket.
//
// Pinout (privzeto, ESP32 WROOM-32 DevKit):
//   GPS       RX = GPIO16,  TX = GPIO17  (UART2), 9600 baud
//   RS485     RO = GPIO25,  DI = GPIO26,  DE/RE = GPIO27  (UART1), 57600 baud (= sejalnica)
//   LED       GPIO2 (onboard) — stanje povezave
//
// Več informacij v docs/PROTOCOL.md

#include <Arduino.h>
#include <NimBLEDevice.h>
#include <TinyGPSPlus.h>
#include <ArduinoJson.h>
#include "sejalnica_proto.h"

// ----------- KONFIGURACIJA -----------
#ifndef BLE_DEVICE_NAME
#define BLE_DEVICE_NAME "AgroESP-01"
#endif

// Ti UUID-ji morajo biti identični tistim v JS (constants.js)
#define SVC_UUID   "6b00a11e-1111-4a50-8000-000000000001"
#define TX_UUID    "6b00a11e-1111-4a50-8000-000000000002"  // ESP -> telefon (notify)
#define RX_UUID    "6b00a11e-1111-4a50-8000-000000000003"  // telefon -> ESP (write)
#define INFO_UUID  "6b00a11e-1111-4a50-8000-000000000004"  // read-only info

// Pinout
#define GPS_RX_PIN      16
#define GPS_TX_PIN      17
#define GPS_BAUD        9600
#define RS485_RX_PIN    25
#define RS485_TX_PIN    26
#define RS485_DE_PIN    27
#ifndef RS485_BAUD
#define RS485_BAUD      57600   // sejalnica linija; za druge stroje preglasi z build_flags
#endif
#define LED_PIN          2

// Telemetrijski interval v ms
static const uint32_t TELEMETRY_INTERVAL_MS = 500;
// Interval za GPS fix paket (ločeno od telemetrije, hitreje če se spreminja)
static const uint32_t GPS_INTERVAL_MS = 500;
// Koliko časa brez RS485 sporočila pomeni "RS485 NI OK"
static const uint32_t RS485_TIMEOUT_MS = 3000;

// ----------- STATE -----------
HardwareSerial GPSSerial(2);
HardwareSerial RS485Serial(1);
TinyGPSPlus gps;

// Stanje iz stroja (RS485)
struct MachineState {
  bool active = false;
  float width_m = 3.0f;
  float flow = NAN;               // trenutna doza (sejalnica: actualKgHa)
  char machine_tag[16] = "sejalnica";
  uint32_t lastMsgMs = 0;
  bool rs485_ok = false;
  // Sejalnica dodatno:
  bool  lifted = false;
  uint8_t alarms = 0;             // bitmask (bit0 noSpeed .. bit4 invalidParams)
  float machSpeedKmh = NAN;       // hitrost, kot jo vidi stroj
  float sessionAreaHa = NAN;      // površina, ki jo šteje stroj sam
  float setKgHa = NAN;            // nastavljeni odmerek (iz kabine)
  float rxRateKgHa = NAN;         // ciljni odmerek s telefona (predpisna karta)
  // ISOBUS/CAN (J1939) — ko je priklopljen transceiver (glej CAN_ENABLED):
  float engRpm = NAN;
  float fuelLh = NAN;
} mach;

// BLE
NimBLEServer* bleServer = nullptr;
NimBLECharacteristic* txChar = nullptr;
NimBLECharacteristic* rxChar = nullptr;
NimBLECharacteristic* infoChar = nullptr;
bool deviceConnected = false;

void sendJson(const String& json); // forward — uporabljen v RxCallbacks

class ServerCallbacks : public NimBLEServerCallbacks {
  void onConnect(NimBLEServer* pServer) override {
    deviceConnected = true;
    digitalWrite(LED_PIN, HIGH);
    Serial.println("BLE: povezano");
  }
  void onDisconnect(NimBLEServer* pServer) override {
    deviceConnected = false;
    digitalWrite(LED_PIN, LOW);
    Serial.println("BLE: odklopljeno, ponovni advertise");
    NimBLEDevice::startAdvertising();
  }
};

class RxCallbacks : public NimBLECharacteristicCallbacks {
  void onWrite(NimBLECharacteristic* ch) override {
    std::string val = ch->getValue();
    if (val.empty()) return;
    Serial.printf("RX: %s\n", val.c_str());
    // Parse JSON ukaz
    JsonDocument doc;
    auto err = deserializeJson(doc, val);
    if (err){
      Serial.printf("RX parse err: %s\n", err.c_str());
      return;
    }
    const char* cmd = doc["c"] | "";
    if (strcmp(cmd, "ping") == 0){
      sendJson("{\"t\":\"pong\",\"ms\":" + String(millis()) + "}");
    } else if (strcmp(cmd, "sim") == 0){
      // Ročno postavljanje simuliranega stanja iz telefona (za testiranje)
      if (!doc["active"].isNull()) mach.active = (int)doc["active"] ? true : false;
      if (!doc["width"].isNull()) mach.width_m = (float)doc["width"];
      if (!doc["flow"].isNull()) mach.flow = (float)doc["flow"];
      Serial.println("Sim stanje posodobljeno iz telefona");
    } else if (strcmp(cmd, "rate") == 0){
      // Predpisna karta: ciljni odmerek iz telefona. Zaenkrat samo hranimo in
      // vračamo v telemetriji (rxrate) — posredovanje sejalnici po RS485 pride
      // z nadgradnjo njenega firmware-a (varen "override" okvir).
      if (!doc["v"].isNull()) mach.rxRateKgHa = (float)doc["v"];
    } else if (strcmp(cmd, "setname") == 0){
      // Bi lahko preimenovali stroj (persistence z Preferences bi dodal)
      const char* n = doc["name"] | "";
      if (*n){ strncpy(mach.machine_tag, n, sizeof(mach.machine_tag)-1); }
    }
  }
};

// ----------- RS485 I/O -----------
void rs485SetTx(bool tx){ digitalWrite(RS485_DE_PIN, tx ? HIGH : LOW); }

void rs485Send(const String& s){
  rs485SetTx(true);
  RS485Serial.print(s);
  RS485Serial.flush();
  delayMicroseconds(200);
  rs485SetTx(false);
}

// ---- SEJALNICA binarni parser ----
// Ob veljavnem statusu je stroj "aktiven", ko se valjček dejansko vrti in
// sejalnica ni dvignjena — fizična resnica, neodvisna od načina/alarmov.
static const float SEJ_ACTIVE_MIN_RPM = 0.5f;

void handleSejStatus(const SejalnicaStatus& s){
  mach.lastMsgMs = millis();
  mach.rs485_ok = true;
  mach.active = (s.actualRPM > SEJ_ACTIVE_MIN_RPM) && !s.isLifted;
  mach.lifted = s.isLifted;
  mach.flow = s.actualKgHa;
  mach.machSpeedKmh = s.filteredSpeedKmh;
  mach.sessionAreaHa = s.sessionAreaHa;
  mach.alarms = (s.alarmNoSpeed      ? 1 : 0)
              | (s.alarmNoRoller     ? 2 : 0)
              | (s.alarmStalled      ? 4 : 0)
              | (s.alarmSpeedTooLow  ? 8 : 0)
              | (s.alarmInvalidParams? 16 : 0);
}

void handleSejSettings(const SejalnicaSettings& st){
  mach.lastMsgMs = millis();
  mach.rs485_ok = true;
  if (st.workingWidthM > 0.1f && st.workingWidthM < 50.0f) mach.width_m = st.workingWidthM;
  mach.setKgHa = st.setKgHa;
}

// State-machine za [0xAA][TIP][LEN][PAYLOAD][CRC8]; teče vzporedno z
// ASCII line parserjem na istih bajtih (0xAA in binarni payload nista
// printable, zato se ne mešata z KEY:VALUE vrsticami).
void feedSejParser(uint8_t b){
  enum class St : uint8_t { WAIT, TYPE, LEN, PAYLOAD, CRC };
  static St st = St::WAIT;
  static uint8_t type = 0, len = 0, idx = 0;
  static uint8_t buf[64];

  switch (st){
    case St::WAIT:
      if (b == SEJ_START_BYTE) st = St::TYPE;
      break;
    case St::TYPE:
      type = b; st = St::LEN;
      break;
    case St::LEN:
      len = b; idx = 0;
      if (len > sizeof(buf)){ st = St::WAIT; break; }
      st = (len == 0) ? St::CRC : St::PAYLOAD;
      break;
    case St::PAYLOAD:
      buf[idx++] = b;
      if (idx >= len) st = St::CRC;
      break;
    case St::CRC: {
      uint8_t chk[2 + sizeof(buf)];
      chk[0] = type; chk[1] = len;
      memcpy(&chk[2], buf, len);
      if (b == sejCrc8(chk, 2 + len)){
        if (type == SEJ_TYPE_STATUS && len == sizeof(SejalnicaStatus)){
          SejalnicaStatus s; memcpy(&s, buf, sizeof(s));
          handleSejStatus(s);
        } else if (type == SEJ_TYPE_SETTINGS && len == sizeof(SejalnicaSettings)){
          SejalnicaSettings s; memcpy(&s, buf, sizeof(s));
          handleSejSettings(s);
        }
        // druge tipe (ACK, sysinfo, service) ignoriramo
      }
      st = St::WAIT;
      break;
    }
  }
}

// Preprost line-protocol parser: KEY:VALUE\n
// Primeri:
//   ACTIVE:1
//   WIDTH:3.0
//   FLOW:42.5
//   NAME:sejalnica
//   SPEED:7.3   (km/h, neobvezno — fallback, če nimaš GPS)
void handleRs485Line(const String& line){
  int c = line.indexOf(':');
  if (c < 1) return;
  String key = line.substring(0, c); key.trim(); key.toUpperCase();
  String val = line.substring(c + 1); val.trim();
  mach.lastMsgMs = millis();
  mach.rs485_ok = true;
  if (key == "ACTIVE"){
    mach.active = (val.toInt() != 0);
  } else if (key == "WIDTH"){
    float w = val.toFloat(); if (w > 0 && w < 50) mach.width_m = w;
  } else if (key == "FLOW"){
    mach.flow = val.toFloat();
  } else if (key == "NAME"){
    strncpy(mach.machine_tag, val.c_str(), sizeof(mach.machine_tag) - 1);
    mach.machine_tag[sizeof(mach.machine_tag) - 1] = 0;
  }
}

void readRs485(){
  static String buf;
  while (RS485Serial.available()){
    uint8_t raw = RS485Serial.read();
    feedSejParser(raw);              // sejalnica binarni protokol
    char c = (char)raw;              // generični tekstovni protokol
    if (c == '\r') continue;
    if (c == '\n'){
      if (buf.length()) handleRs485Line(buf);
      buf = "";
    } else if (c >= 32 && c < 127){  // samo printable — binarni bajti ne smetijo
      if (buf.length() < 120) buf += c;
    }
  }
  if (mach.rs485_ok && (millis() - mach.lastMsgMs) > RS485_TIMEOUT_MS){
    mach.rs485_ok = false;
  }
}

// ----------- BLE SEND HELPERS -----------
void sendJson(const String& json){
  if (!deviceConnected || !txChar) return;
  // NimBLE default MTU = 23 -> 20 B payload. Po MTU negotiation obicajno ~183 B.
  // ArduinoJson packet je običajno 120-180 B, kar ustreza.
  txChar->setValue((uint8_t*)json.c_str(), json.length());
  txChar->notify();
}

// ----------- TELEMETRIJA -----------
void sendTelemetry(){
  JsonDocument doc;
  doc["t"] = "tel";
  doc["ms"] = millis();
  doc["active"] = mach.active ? 1 : 0;
  doc["mach"] = mach.machine_tag;
  doc["w"] = mach.width_m;
  doc["rs485_ok"] = mach.rs485_ok ? 1 : 0;
  if (!isnan(mach.flow)) doc["flow"] = mach.flow;
  if (mach.rs485_ok){
    doc["lift"] = mach.lifted ? 1 : 0;
    doc["alarm"] = mach.alarms;
    if (!isnan(mach.machSpeedKmh)) doc["mspd"] = mach.machSpeedKmh;
    if (!isnan(mach.sessionAreaHa)) doc["marea"] = mach.sessionAreaHa;
    if (!isnan(mach.setKgHa)) doc["set"] = mach.setKgHa;
  }
  if (!isnan(mach.rxRateKgHa)) doc["rxrate"] = mach.rxRateKgHa;
  if (!isnan(mach.engRpm)) doc["rpm"] = mach.engRpm;
  if (!isnan(mach.fuelLh)) doc["fuellh"] = mach.fuelLh;
  String out; out.reserve(160);
  serializeJson(doc, out);
  sendJson(out);
}

void sendGps(){
  if (!gps.location.isValid()) return;
  JsonDocument doc;
  doc["t"] = "gps";
  doc["lat"] = gps.location.lat();
  doc["lng"] = gps.location.lng();
  if (gps.speed.isValid())    doc["spd"] = gps.speed.kmph();
  if (gps.course.isValid())   doc["hdg"] = gps.course.deg();
  if (gps.hdop.isValid())     doc["hdop"] = gps.hdop.hdop();
  if (gps.satellites.isValid()) doc["sats"] = gps.satellites.value();
  if (gps.altitude.isValid()) doc["alt"] = gps.altitude.meters();
  doc["fix"] = gps.location.isValid() ? 1 : 0;
  String out; out.reserve(180);
  serializeJson(doc, out);
  sendJson(out);
}

// ----------- ISOBUS / CAN (J1939) — priprava -----------
// Traktorjev CAN (diagnostični priključek) prek transceiverja (SN65HVD230, ~3 €).
// Vklop: v platformio.ini odkomentiraj -D CAN_ENABLED (+ po potrebi pina).
// Bere: EEC1 (PGN 61444) obrati motorja, LFE (PGN 65266) trenutna poraba.
#ifdef CAN_ENABLED
#include "driver/twai.h"
#ifndef CAN_TX_PIN
#define CAN_TX_PIN 21
#endif
#ifndef CAN_RX_PIN
#define CAN_RX_PIN 22
#endif

void canInit(){
  twai_general_config_t g = TWAI_GENERAL_CONFIG_DEFAULT((gpio_num_t)CAN_TX_PIN, (gpio_num_t)CAN_RX_PIN, TWAI_MODE_LISTEN_ONLY);
  twai_timing_config_t t = TWAI_TIMING_CONFIG_250KBITS();   // J1939 = 250 kbit/s
  twai_filter_config_t fcfg = TWAI_FILTER_CONFIG_ACCEPT_ALL();
  if (twai_driver_install(&g, &t, &fcfg) == ESP_OK && twai_start() == ESP_OK){
    Serial.println("CAN (J1939) poslušanje aktivno");
  } else {
    Serial.println("CAN init NI uspel");
  }
}

void canPoll(){
  twai_message_t msg;
  while (twai_receive(&msg, 0) == ESP_OK){
    if (!msg.extd) continue;                     // J1939 = 29-bit ID
    uint32_t pgn = (msg.identifier >> 8) & 0x3FFFF;
    if ((pgn & 0xFF00) < 0xF000) pgn &= 0x3FF00; // PDU1: PS je naslov
    if (pgn == 61444 && msg.data_length_code >= 5){        // EEC1
      mach.engRpm = ((msg.data[4] << 8) | msg.data[3]) * 0.125f;
    } else if (pgn == 65266 && msg.data_length_code >= 2){ // Fuel Economy (LFE)
      mach.fuelLh = ((msg.data[1] << 8) | msg.data[0]) * 0.05f;
    }
  }
}
#endif

// ----------- SETUP / LOOP -----------
void setup(){
  Serial.begin(115200);
  delay(200);
  Serial.println("\n== AgroTracker ESP32 modul ==");
  Serial.println("Ime: " BLE_DEVICE_NAME);

  pinMode(LED_PIN, OUTPUT);
  digitalWrite(LED_PIN, LOW);
  pinMode(RS485_DE_PIN, OUTPUT);
  rs485SetTx(false);

  GPSSerial.begin(GPS_BAUD, SERIAL_8N1, GPS_RX_PIN, GPS_TX_PIN);
  RS485Serial.begin(RS485_BAUD, SERIAL_8N1, RS485_RX_PIN, RS485_TX_PIN);

  // BLE init
  NimBLEDevice::init(BLE_DEVICE_NAME);
  NimBLEDevice::setPower(ESP_PWR_LVL_P9);
  NimBLEDevice::setMTU(185);
  bleServer = NimBLEDevice::createServer();
  bleServer->setCallbacks(new ServerCallbacks());

  NimBLEService* svc = bleServer->createService(SVC_UUID);
  txChar = svc->createCharacteristic(TX_UUID, NIMBLE_PROPERTY::NOTIFY | NIMBLE_PROPERTY::READ);
  rxChar = svc->createCharacteristic(RX_UUID, NIMBLE_PROPERTY::WRITE | NIMBLE_PROPERTY::WRITE_NR);
  rxChar->setCallbacks(new RxCallbacks());
  infoChar = svc->createCharacteristic(INFO_UUID, NIMBLE_PROPERTY::READ);
  infoChar->setValue(
    "{\"fw\":\"1.0.0\",\"dev\":\"" BLE_DEVICE_NAME "\",\"proto\":1}");

  svc->start();

  NimBLEAdvertising* adv = NimBLEDevice::getAdvertising();
  adv->addServiceUUID(SVC_UUID);
  adv->setName(BLE_DEVICE_NAME);
  adv->setScanResponse(true);
  NimBLEDevice::startAdvertising();

  Serial.println("BLE advertise zagnan, čakam povezavo...");
#ifdef CAN_ENABLED
  canInit();
#endif
}

uint32_t lastTelem = 0;
uint32_t lastGps   = 0;

void loop(){
  // GPS NMEA parsanje
  while (GPSSerial.available()){
    gps.encode(GPSSerial.read());
  }

  // RS485 vhod
  readRs485();
#ifdef CAN_ENABLED
  canPoll();
#endif

#ifdef SIM_MODE
  // Fiktivni premikajoči GPS + aktiven stroj (za test brez strojne opreme)
  static double simLat = 46.0515, simLng = 14.5030;
  static uint32_t lastSim = 0;
  if (millis() - lastSim > 200){
    lastSim = millis();
    simLng += 0.000015;   // ~1m na vzhod pri tej lat
    mach.active = true;
    mach.rs485_ok = true;
    mach.width_m = 3.0f;
    mach.flow = 22.5f;
    mach.lastMsgMs = millis();
    // Ročno pošljemo "GPS" paket
    if (deviceConnected && millis() - lastGps > GPS_INTERVAL_MS){
      JsonDocument doc;
      doc["t"] = "gps";
      doc["lat"] = simLat;
      doc["lng"] = simLng;
      doc["spd"] = 7.5;
      doc["hdg"] = 90;
      doc["hdop"] = 0.9;
      doc["sats"] = 12;
      doc["fix"] = 3;
      String out; serializeJson(doc, out);
      sendJson(out);
      lastGps = millis();
    }
  }
#else
  // Pravi GPS paketi
  if (deviceConnected && (millis() - lastGps > GPS_INTERVAL_MS)){
    lastGps = millis();
    if (gps.location.isUpdated() || gps.location.isValid()){
      sendGps();
    }
  }
#endif

  // Telemetrija stroja
  if (deviceConnected && (millis() - lastTelem > TELEMETRY_INTERVAL_MS)){
    lastTelem = millis();
    sendTelemetry();
  }

  // LED hitro utripanje, dokler ni povezan
  if (!deviceConnected){
    digitalWrite(LED_PIN, (millis() / 500) % 2);
  }

  delay(2);
}
