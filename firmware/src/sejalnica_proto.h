// sejalnica_proto.h — žični structi RS485 protokola SEJALNICE (samo tisto, kar
// AgroTracker modul posluša). KOPIJA iz sejalnica repo `shared/rs485_proto.h`
// (github lenartk/sejalnica, veja dev-konsolidacija) — ob spremembi žice tam
// posodobi tudi tu. static_assert spodaj in LEN preverjanje v parserju
// poskrbita, da ob neujemanju modul podatke ignorira (ne kaže napačnih).
//
// Frame: [0xAA][TIP][LEN][PAYLOAD...][CRC8]
//   CRC8: poly 0x31, init 0x00, MSB-first, računan čez [TIP][LEN][PAYLOAD]
//   0x01 sejalnica->kabina : SejalnicaStatus (45 B)
//   0x02 kabina->sejalnica : SejalnicaSettings (57 B)
// Baud: 57600 8N1. Modul je SAMO POSLUŠALEC (DE trajno LOW).
#pragma once
#include <stdint.h>

static const uint8_t SEJ_START_BYTE   = 0xAA;
static const uint8_t SEJ_TYPE_STATUS  = 0x01;
static const uint8_t SEJ_TYPE_SETTINGS= 0x02;

// = OutgoingStatus v sejalnici
struct __attribute__((packed)) SejalnicaStatus {
    float   speedKmh;
    float   filteredSpeedKmh;
    float   targetRPM;
    float   actualRPM;
    float   actualKgHa;
    float   sessionAreaHa;
    float   totalAreaHa;
    uint8_t rollerPWM;
    uint8_t fanPercent;
    uint8_t mode;               // 0=AUTO 1=MANUAL 2=CALIBRATION
    bool    isLifted;
    bool    alarmNoSpeed;
    bool    alarmNoRoller;
    bool    alarmStalled;
    bool    alarmSpeedTooLow;
    bool    alarmInvalidParams;
    bool    speedValid;
    bool    rollerValid;
    uint8_t  calState;
    uint16_t calPulses;
    uint16_t calTargetPulses;
    bool     fanRunning;
};

// = IncomingSettings v sejalnici (poslušamo samo zaradi workingWidthM in setKgHa)
struct __attribute__((packed)) SejalnicaSettings {
    float   setKgHa;
    float   correctionFactor;
    uint8_t fanPercent;
    float   gramsPerRev;
    float   workingWidthM;
    float   wheelCircumferenceM;
    uint8_t wheelPulsesPerRev;
    uint8_t rollerPulsesPerRev;
    float   kp;
    float   ki;
    uint8_t minMotorPWM;
    uint8_t maxMotorPWM;
    float   targetRampStep;
    float   minWorkingSpeedKmh;
    bool    enableAutoMode;
    bool    enableManualMode;
    uint8_t manualRollerPWM;
    float   manualRollerRPM;
    bool    calibrationStart;
    bool    calibrationStop;
    float   simulatedSpeedKmh;
    bool    operativeEnabled;
    bool    serviceFanOverride;
    bool    serviceRollerOverride;
};

static_assert(sizeof(SejalnicaStatus)   == 45, "SejalnicaStatus: zica se ne ujema s sejalnico");
static_assert(sizeof(SejalnicaSettings) == 57, "SejalnicaSettings: zica se ne ujema s sejalnico");

// Enak CRC8 kot v sejalnici (comm_hooks.cpp)
static inline uint8_t sejCrc8(const uint8_t* data, uint8_t len){
    uint8_t crc = 0x00;
    for (uint8_t i = 0; i < len; i++){
        crc ^= data[i];
        for (uint8_t b = 0; b < 8; b++) crc = (crc & 0x80) ? ((crc << 1) ^ 0x31) : (crc << 1);
    }
    return crc;
}
