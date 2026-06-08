/**
 * @file schematik_esp32.ino
 * @brief TERANODE standalone device sketch (ESP32, no cloud).
 *
 * A self-contained bench/demo build: reads the NBL-S-TMC-7 7-in-1 RS485 soil
 * probe + DHT22 + rain + YF-S201 flow, picks targets from a small local crop
 * table, and drives a relay (pump/valve) by moisture hysteresis — with no WiFi
 * or MQTT. Use it to validate the sensors + control logic before flashing the
 * connected gateway (teranode_gateway.ino). See docs: components/firmware.
 */
// TerraNode - Smart Agriculture System (ESP32 DevKit)
// Sensors: NBL-S-TMC-7 (RS485 Modbus), DHT22, Rain Sensor, YF-S201 Flow
// Actuator: Relay (pump/valve control)

#include <Arduino.h>
#include <ModbusMaster.h>
#include <DHT.h>

// ── Pin Definitions ──────────────────────────────────────────────
#define PIN_RS485_DE_RE   14   // MAX485 DE+RE (direction control)
#define PIN_RS485_TX      17   // ESP32 TX2 → MAX485 DI
#define PIN_RS485_RX      16   // ESP32 RX2 → MAX485 RO
#define PIN_DHT22         18
#define PIN_RAIN_DO       19
#define PIN_FLOW          21
#define PIN_RELAY         22
#define PIN_RAIN_AO       25   // Analog rain intensity

// ── Constants ────────────────────────────────────────────────────
#define DHTTYPE           DHT22
#define MODBUS_ADDR       1
#define BAUD_RS485        9600
#define MOISTURE_ON_THR   40.0f   // % below → pump ON
#define MOISTURE_OFF_THR  70.0f   // % above → pump OFF
#define POLL_INTERVAL_MS  5000

// ── Flow sensor ──────────────────────────────────────────────────

// Hoisted type definitions
/** @brief One decoded 7-in-1 soil reading (EC in µS/cm; N/P/K are coarse estimates). */
struct SoilData {
  float moisture;    // %
  float tempC;       // °C
  float ec;          // µS/cm
  float pH;
  float nitrogen;    // mg/kg
  float phosphorus;
  float potassium;
  bool  valid;
};

/** @brief A local crop preset: spacing, daily water baseline, and moisture target. */
struct Crop {
  const char* name;
  float spacingM;       // plant spacing metres
  float dailyWaterMM;   // mm/day baseline
  float moistureTarget; // % target
};

volatile uint32_t flowPulseCount = 0;
/** @brief Flow-meter pulse ISR — increments the YF-S201 pulse counter. */
void IRAM_ATTR flowISR() { flowPulseCount++; }

// ── Objects ──────────────────────────────────────────────────────
ModbusMaster node;
DHT dht(PIN_DHT22, DHTTYPE);

// ── Soil sensor data ─────────────────────────────────────────────


// ── Crop table (compact) ─────────────────────────────────────────


// 10 crops, minimal table
static const Crop CROPS[] = {
  {"Tomato",    0.50f, 5.0f, 65.0f},
  {"Potato",    0.30f, 6.0f, 70.0f},
  {"Onion",     0.15f, 3.5f, 55.0f},
  {"Carrot",    0.10f, 4.0f, 60.0f},
  {"Radish",    0.10f, 3.0f, 55.0f},
  {"Chili",     0.45f, 4.5f, 60.0f},
  {"Garlic",    0.10f, 3.0f, 55.0f},
  {"Ginger",    0.25f, 5.5f, 65.0f},
  {"Coriander", 0.10f, 2.5f, 50.0f},
  {"Mint",      0.20f, 4.0f, 60.0f},
};
static const uint8_t NUM_CROPS = sizeof(CROPS) / sizeof(CROPS[0]);

// ── State ─────────────────────────────────────────────────────────
uint8_t  selectedCrop  = 0;
float    landLength    = 5.0f;   // metres
float    landWidth     = 4.0f;
bool     pumpOn        = false;
uint32_t lastPoll      = 0;

// ── RS485 direction callbacks ────────────────────────────────────
void preTransmit()  { digitalWrite(PIN_RS485_DE_RE, HIGH); }
void postTransmit() { digitalWrite(PIN_RS485_DE_RE, LOW);  }

// ── Read soil sensor via Modbus ──────────────────────────────────
/**
 * @brief Read the 7-in-1 probe via Modbus 0x03 (regs 0x00..0x06).
 * @return Decoded SoilData; `valid=false` on a bus error.
 */
SoilData readSoilSensor() {
  SoilData d = {0, 0, 0, 0, 0, 0, 0, false};
  // NBL-S-TMC-7 (per manufacturer manual): holding regs 0x0000-0x0006 =
  //   Temp, Moisture, EC(µS/cm), pH, N, P, K   [Temp & Moisture order matters!]
  // Scalings: Temp/10, Moisture/10, EC×1, pH/100, N/P/K×1.
  uint8_t result = node.readHoldingRegisters(0x0000, 7);
  if (result == node.ku8MBSuccess) {
    d.tempC      = node.getResponseBuffer(0) / 10.0f;   // reg0 Temperature
    d.moisture   = node.getResponseBuffer(1) / 10.0f;   // reg1 Moisture
    d.ec         = node.getResponseBuffer(2) * 1.0f;    // reg2 EC (µS/cm)
    d.pH         = node.getResponseBuffer(3) / 100.0f;  // reg3 pH (raw/100)
    d.nitrogen   = node.getResponseBuffer(4) * 1.0f;    // N/P/K are EC-derived estimates
    d.phosphorus = node.getResponseBuffer(5) * 1.0f;
    d.potassium  = node.getResponseBuffer(6) * 1.0f;
    d.valid      = true;
  } else {
    Serial.printf("[Modbus] Error: 0x%02X\n", result);
  }
  return d;
}

// ── Pump control ─────────────────────────────────────────────────
/**
 * @brief Drive the pump/valve relay (active-LOW).
 * @param on true = pump ON.
 */
void setPump(bool on) {
  pumpOn = on;
  // Relay: active-LOW (most relay modules) — LOW = relay ON
  digitalWrite(PIN_RELAY, on ? LOW : HIGH);
  Serial.printf("[Pump] %s\n", on ? "ON" : "OFF");
}

// ── Print summary ────────────────────────────────────────────────
/**
 * @brief Print a human-readable status block to the serial monitor.
 * @param soil    Latest soil reading.
 * @param airTemp Air temperature (°C).
 * @param airHum  Air humidity (%).
 * @param raining Rain flag.
 * @param flowLPM Flow rate (L/min).
 */
void printStatus(const SoilData& soil, float airTemp, float airHum,
                 bool raining, float flowLPM) {
  Serial.println("══════════ TerraNode ══════════");
  Serial.printf("Crop      : %s\n", CROPS[selectedCrop].name);
  float area   = landLength * landWidth;
  float plants = area / (CROPS[selectedCrop].spacingM *
                         CROPS[selectedCrop].spacingM);
  float waterL = area * CROPS[selectedCrop].dailyWaterMM * 10.0f; // L/day
  Serial.printf("Area      : %.1f m²  Plants: %.0f\n", area, plants);
  Serial.printf("Water/day : %.1f L\n", waterL);
  if (soil.valid) {
    Serial.printf("Moisture  : %.1f %%\n", soil.moisture);
    Serial.printf("Soil Temp : %.1f C\n",  soil.tempC);
    Serial.printf("EC        : %.0f uS/cm\n", soil.ec);
    Serial.printf("pH        : %.1f\n",    soil.pH);
    Serial.printf("N/P/K     : %.0f / %.0f / %.0f mg/kg\n",
                  soil.nitrogen, soil.phosphorus, soil.potassium);
  } else {
    Serial.println("Soil      : --- (sensor error)");
  }
  Serial.printf("Air       : %.1f C  %.1f %%RH\n", airTemp, airHum);
  Serial.printf("Rain      : %s\n",   raining ? "YES" : "No");
  Serial.printf("Flow      : %.2f L/min\n", flowLPM);
  Serial.printf("Pump      : %s\n",   pumpOn  ? "ON"  : "OFF");
  Serial.println("═══════════════════════════════");
}

// ── Setup ────────────────────────────────────────────────────────
/** @brief Arduino setup: init serial, RS485/Modbus, relay, rain, flow ISR, DHT. */
void setup() {
  Serial.begin(115200);
  delay(500);

  // RS485 direction pin
  pinMode(PIN_RS485_DE_RE, OUTPUT);
  digitalWrite(PIN_RS485_DE_RE, LOW); // receive mode

  // Relay
  pinMode(PIN_RELAY, OUTPUT);
  digitalWrite(PIN_RELAY, HIGH); // relay OFF (active-low module)

  // Rain sensor digital
  pinMode(PIN_RAIN_DO, INPUT);

  // Flow sensor interrupt
  pinMode(PIN_FLOW, INPUT_PULLUP);
  attachInterrupt(digitalPinToInterrupt(PIN_FLOW), flowISR, RISING);

  // DHT22
  dht.begin();

  // Modbus over Serial2
  Serial2.begin(BAUD_RS485, SERIAL_8N1, PIN_RS485_RX, PIN_RS485_TX);
  node.begin(MODBUS_ADDR, Serial2);
  node.preTransmission(preTransmit);
  node.postTransmission(postTransmit);

  Serial.println("[TerraNode] Boot OK");

  // TODO: In a real deployment, let user choose crop + land size via
  // serial menu, BLE, or web interface. Defaults used here.
  selectedCrop = 0;   // Tomato
  landLength   = 5.0f;
  landWidth    = 4.0f;
}

// ── Loop ─────────────────────────────────────────────────────────
/**
 * @brief Arduino main loop: poll sensors, compute flow, run moisture-hysteresis
 *        pump control (with rain-skip), and print status every POLL_INTERVAL_MS.
 */
void loop() {
  uint32_t now = millis();
  if (now - lastPoll < POLL_INTERVAL_MS) return;
  lastPoll = now;

  // ── Flow calculation (pulses since last poll) ─────────────────
  noInterrupts();
  uint32_t pulses = flowPulseCount;
  flowPulseCount  = 0;
  interrupts();
  // YF-S201: Hz = 7.5 × L/min  → L/min = (pulses/interval_s) / 7.5
  float intervalS = POLL_INTERVAL_MS / 1000.0f;
  float flowLPM   = (pulses / intervalS) / 7.5f;

  // ── Read sensors ─────────────────────────────────────────────
  SoilData soil = readSoilSensor();
  float airTemp  = dht.readTemperature();
  float airHum   = dht.readHumidity();
  if (isnan(airTemp)) airTemp = -99.0f;
  if (isnan(airHum))  airHum  = -99.0f;

  // Rain: D0 LOW = rain detected (LM393 comparator, active-low output)
  bool raining = (digitalRead(PIN_RAIN_DO) == LOW);

  // ── Irrigation logic ─────────────────────────────────────────
  if (raining) {
    if (pumpOn) {
      Serial.println("[Logic] Rain detected → pump OFF");
      setPump(false);
    }
  } else if (soil.valid) {
    float tgt = CROPS[selectedCrop].moistureTarget;
    if (!pumpOn && soil.moisture < MOISTURE_ON_THR) {
      Serial.println("[Logic] Moisture low → pump ON");
      setPump(true);
    } else if (pumpOn && soil.moisture >= tgt) {
      Serial.println("[Logic] Moisture OK → pump OFF");
      setPump(false);
    }
  }

  // ── Print status ─────────────────────────────────────────────
  printStatus(soil, airTemp, airHum, raining, flowLPM);
}