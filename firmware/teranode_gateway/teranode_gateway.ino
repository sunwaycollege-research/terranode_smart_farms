/**
 * @file teranode_gateway.ino
 * @brief TERANODE connected ESP32 field gateway.
 *
 * Reads a 7-in-1 RS485 soil probe + DHT22 + rain sensor + YF-S201 flow meter,
 * runs an offline-first edge irrigation control loop (moisture hysteresis,
 * rain-skip, irrigation window, max-run safety, leak detection) driving a relay
 * (pump + solenoid valve), and syncs to the TERANODE cloud over MQTT.
 *
 * Uses the **device-id-first** model: the unit knows only its own
 * `{ serial, secret }` and calls `POST /provision` to discover which
 * customer/farm it belongs to, then publishes telemetry/state on
 * `teranode/dev/<serial>/...`. See the docs pages *components/firmware* and
 * *architecture/device-lifecycle*.
 */
// ============================================================================
// TERANODE — Connected Gateway Firmware (ESP32 DevKit v1)
// ----------------------------------------------------------------------------
// The field "brain". Reads the real BOM sensors, runs the irrigation control
// loop LOCALLY (so the farm keeps watering through internet/cloud outages), and
// syncs to the TERANODE cloud over MQTT using the DEVICE-ID-FIRST provisioning
// model — the device knows only its own { serial, secret } and phones home to
// discover which customer/farm it belongs to.
//
// Hardware (see ../TerraNode/pins.csv + assembly.md):
//   • NBL-S-TMC-7 7-in-1 soil sensor  — RS485/Modbus via MAX485 (Serial2)
//       regs 0x0000..0x0006 = moisture, soilTemp, EC(µS/cm), pH, N, P, K
//   • DHT22                           — air temp + humidity      (GPIO18)
//   • Rain sensor (LM393)             — D0 digital (GPIO19), A0 analog (GPIO25)
//   • YF-S201 flow meter              — pulse, ~7.5 Hz per L/min (GPIO21)
//   • Relay → 12V pump + solenoid valve                          (GPIO22, active-LOW)
//
// Lifecycle:
//   boot → WiFi (NVS creds / SoftAP portal) → POST /provision {serial,secret}
//   → {accountId,farmId,gatewayId,mqttUrl,topicPrefix} → MQTT connect
//   → publish telemetry/zone/1 + telemetry/weather + telemetry/gateway/health
//   → subscribe cmd/gateway/config (rule push) + cmd/zone/1/valve (manual)
//   → edge control loop drives the relay + leak detection
//
// MQTT topics (match apps/ingest subscriptions):
//   {prefix}/telemetry/zone/1          soil + valve/pump/mode
//   {prefix}/telemetry/weather         airTemp/humidity/rain/flow
//   {prefix}/telemetry/gateway/health  fw/rssi/uptime/status
//   {prefix}/state/zone/1              retained reported valve state
//   {prefix}/cmd/#                     subscribed: config + manual override
// where {prefix} = "teranode/dev/<SERIAL>"
//
// Libraries: WiFi, HTTPClient, WiFiClientSecure(optional), PubSubClient,
//            ArduinoJson, ModbusMaster, DHT sensor library, Preferences (NVS).
// ============================================================================

#include <Arduino.h>
#include <WiFi.h>
#include <HTTPClient.h>
#include <Preferences.h>
#include <PubSubClient.h>
#include <ArduinoJson.h>
#include <ModbusMaster.h>
#include <DHT.h>

// ── Device identity (flashed per unit at manufacture) ────────────────────────
// In production these are written to NVS by the factory provisioner; the
// compile-time defaults let you flash a dev unit directly.
#define DEVICE_SERIAL_DEFAULT  "TN-ESP32-0001"
#define DEVICE_SECRET_DEFAULT  "flash-me-secret"
#define API_BASE_DEFAULT       "http://192.168.1.100:4000"   // cloud REST base
#define WIFI_SSID_DEFAULT      ""                            // set via SoftAP in field
#define WIFI_PASS_DEFAULT      ""
#define FW_VERSION             "1.0.0"

// ── Pins (from pins.csv) ─────────────────────────────────────────────────────
#define PIN_RS485_DE_RE  14
#define PIN_RS485_TX     17   // ESP32 TX2 → MAX485 DI
#define PIN_RS485_RX     16   // ESP32 RX2 → MAX485 RO
#define PIN_DHT22        18
#define PIN_RAIN_DO      19
#define PIN_RAIN_AO      25
#define PIN_FLOW         21
#define PIN_RELAY        22

// ── Constants ────────────────────────────────────────────────────────────────
#define DHTTYPE             DHT22
#define MODBUS_ADDR         1
#define BAUD_RS485          9600
#define PUBLISH_INTERVAL_MS 5000UL    // telemetry cadence
#define CONTROL_INTERVAL_MS 10000UL   // control loop cadence
#define HEALTH_INTERVAL_MS  30000UL   // heartbeat
#define PROVISION_RETRY_MS  30000UL   // re-attempt provisioning while pending
#define FLOW_K_HZ_PER_LPM   7.5f      // YF-S201: Hz = 7.5 × L/min
#define LEAK_GRACE_CYCLES   3         // valve-open + no-flow cycles before leak alert

// Local edge-control defaults (overridden by the cloud's retained config push).
/** @brief Local edge-control thresholds; overridden by the cloud's retained config push. */
struct Rule {
  float moistureLow  = 45.0f;  // %  open valve below
  float moistureHigh = 70.0f;  // %  close valve above
  float rainSkipMm   = 3.0f;   // mm rolling window → skip (UF/IFAS: smallest set point ≈3.2mm saves the most water; never >6.4mm)
  int   windowStart  = 5;      // irrigate only 05:00..19:00 (local-ish, millis day)
  int   windowEnd    = 19;
  int   maxRunMin    = 90;     // safety cutoff
};

// ── Globals ──────────────────────────────────────────────────────────────────
Preferences prefs;
ModbusMaster node;
DHT dht(PIN_DHT22, DHTTYPE);
WiFiClient netClient;
PubSubClient mqtt(netClient);

String gSerial, gSecret, gApiBase, gWifiSsid, gWifiPass;
String gTopicPrefix;          // teranode/dev/<serial>
String gMqttHost; uint16_t gMqttPort = 1883;
bool   gProvisioned = false;

Rule  rule;
bool  valveOpen = false;      // reported state (relay)
bool  pumpOn    = false;
bool  autoMode  = true;       // false while a manual override is active
uint32_t manualUntil = 0;     // millis; manual override expiry (0 = none)
uint32_t valveOpenedAt = 0;   // for max-run safety
int   leakCycles = 0;

volatile uint32_t flowPulses = 0;
/** @brief Flow-meter pulse ISR — increments the YF-S201 pulse counter. */
void IRAM_ATTR flowISR() { flowPulses++; }

uint32_t lastPublish = 0, lastControl = 0, lastHealth = 0, lastProvision = 0;

// ── Soil (7-in-1 RS485 Modbus) ───────────────────────────────────────────────
/** @brief One decoded 7-in-1 soil reading (EC normalised to mS/cm; N/P/K are coarse estimates). */
struct Soil { float moisture, soilTemp, ecMScm, pH, n, p, k; bool valid; };
/** @brief MAX485 into transmit mode (DE/RE high). */
void preTx()  { digitalWrite(PIN_RS485_DE_RE, HIGH); }
/** @brief MAX485 back to receive mode (DE/RE low). */
void postTx() { digitalWrite(PIN_RS485_DE_RE, LOW);  }

/**
 * @brief Read all 7 soil values in one Modbus function-0x03 transaction.
 * @return Decoded Soil; `valid=false` on a bus error.
 */
Soil readSoil() {
  Soil s = {0, 0, 0, 0, 0, 0, 0, false};
  // Per the NBL-S-TMC-7 manual (Modbus fn 0x03, holding regs) the order is:
  //   0x00 Temperature, 0x01 Moisture, 0x02 EC, 0x03 pH, 0x04 N, 0x05 P, 0x06 K
  // Scalings: Temp /10 °C, Moisture /10 %, EC raw µS/cm, pH /100, N/P/K raw mg/kg.
  uint8_t r = node.readHoldingRegisters(0x0000, 7);
  if (r == node.ku8MBSuccess) {
    s.soilTemp = node.getResponseBuffer(0) / 10.0f;     // reg0 Temperature (°C ×10)
    s.moisture = node.getResponseBuffer(1) / 10.0f;     // reg1 Moisture (% ×10)
    s.ecMScm   = node.getResponseBuffer(2) / 1000.0f;   // reg2 EC (µS/cm) → mS/cm
    s.pH       = node.getResponseBuffer(3) / 100.0f;    // reg3 pH (raw/100)
    // NOTE: N/P/K are EC-derived estimates (moisture-dependent, "use with
    // caution" per the manual) — treat as a coarse trend, allow calibration, and
    // do NOT drive hard fertigation decisions from the raw probe values alone.
    s.n        = node.getResponseBuffer(4);             // mg/kg (approx)
    s.p        = node.getResponseBuffer(5);             // mg/kg (approx)
    s.k        = node.getResponseBuffer(6);             // mg/kg (approx)
    s.valid    = true;
  } else {
    Serial.printf("[modbus] soil read err 0x%02X\n", r);
  }
  return s;
}

/**
 * @brief Drive the pump+valve relay (active-LOW module) and track open time.
 * @param on true = energise (irrigate); false = stop.
 */
void setRelay(bool on) {
  valveOpen = on;
  pumpOn    = on;                       // single relay drives pump + valve together
  digitalWrite(PIN_RELAY, on ? LOW : HIGH);   // active-LOW module
  if (on) valveOpenedAt = millis();
}

// ── WiFi ─────────────────────────────────────────────────────────────────────
/** @brief Load identity + WiFi credentials from NVS, falling back to compile-time defaults. */
void loadConfig() {
  prefs.begin("teranode", false);
  gSerial   = prefs.getString("serial", DEVICE_SERIAL_DEFAULT);
  gSecret   = prefs.getString("secret", DEVICE_SECRET_DEFAULT);
  gApiBase  = prefs.getString("api",    API_BASE_DEFAULT);
  gWifiSsid = prefs.getString("ssid",   WIFI_SSID_DEFAULT);
  gWifiPass = prefs.getString("pass",   WIFI_PASS_DEFAULT);
  prefs.end();
}

/**
 * @brief Join WiFi in STA mode (or signal that SoftAP provisioning is needed).
 * @param timeoutMs Join timeout in milliseconds.
 * @return true if connected.
 */
bool connectWifi(uint32_t timeoutMs = 20000) {
  if (gWifiSsid.isEmpty()) {
    // PRODUCTION: start a SoftAP captive portal here so the farmer can enter
    // WiFi creds from the app (BLE/SoftAP). Documented in the README; omitted
    // from this reference sketch for brevity. For dev, set WIFI_SSID_DEFAULT.
    Serial.println("[wifi] no credentials — start SoftAP provisioning portal");
    return false;
  }
  WiFi.mode(WIFI_STA);
  WiFi.begin(gWifiSsid.c_str(), gWifiPass.c_str());
  uint32_t start = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - start < timeoutMs) delay(250);
  bool ok = WiFi.status() == WL_CONNECTED;
  Serial.printf("[wifi] %s (%s)\n", ok ? "connected" : "FAILED", WiFi.localIP().toString().c_str());
  return ok;
}

// ── Provisioning (phone home) ────────────────────────────────────────────────
// POST {api}/provision {serial,secret,fwVersion,wifiSsid,capabilities}
//   200 {status:'linked', mqttUrl, topicPrefix, ...}
//   202 {status:'pending'}  → retry later (device sold but not yet linked)
/**
 * @brief Phone home — POST /provision { serial, secret, capabilities }.
 * @return true once linked (caches the MQTT host + topic prefix); false while
 *         pending (sold but not yet claimed) or offline.
 */
bool provision() {
  if (WiFi.status() != WL_CONNECTED) return false;
  HTTPClient http;
  String url = gApiBase + "/provision";
  http.begin(url);
  http.addHeader("Content-Type", "application/json");

  StaticJsonDocument<512> req;
  req["serial"]    = gSerial;
  req["secret"]    = gSecret;
  req["fwVersion"] = FW_VERSION;
  req["wifiSsid"]  = gWifiSsid;
  JsonObject caps  = req.createNestedObject("capabilities");
  JsonArray ch     = caps.createNestedArray("channels");
  ch.add("moisture"); ch.add("soiltemp"); ch.add("ec"); ch.add("ph");
  ch.add("n"); ch.add("p"); ch.add("k");
  ch.add("airtemp"); ch.add("humidity"); ch.add("rain"); ch.add("flow");
  caps["zones"] = 1; caps["pump"] = true;
  String body; serializeJson(req, body);

  int code = http.POST(body);
  String resp = http.getString();
  http.end();
  Serial.printf("[provision] HTTP %d %s\n", code, resp.c_str());

  if (code == 202) return false;              // pending — keep retrying
  if (code != 200) return false;

  StaticJsonDocument<512> res;
  if (deserializeJson(res, resp)) return false;
  const char* mqttUrl = res["mqttUrl"] | "mqtt://192.168.1.100:1883";
  gTopicPrefix = String((const char*) (res["topicPrefix"] | ""));
  // parse mqtt://host:port
  String mu = String(mqttUrl); mu.replace("mqtt://", "");
  int colon = mu.indexOf(':');
  gMqttHost = colon > 0 ? mu.substring(0, colon) : mu;
  gMqttPort = colon > 0 ? mu.substring(colon + 1).toInt() : 1883;
  if (gTopicPrefix.isEmpty()) gTopicPrefix = "teranode/dev/" + gSerial;
  gProvisioned = true;
  Serial.printf("[provision] linked → %s @ %s:%u\n", gTopicPrefix.c_str(), gMqttHost.c_str(), gMqttPort);
  return true;
}

// ── MQTT ─────────────────────────────────────────────────────────────────────
/**
 * @brief Apply a cloud rule push (moisture low/high, rain-skip, window, max-run).
 * @param cfg Parsed `cmd/gateway/config` payload.
 */
void applyConfig(const JsonDocument& cfg) {
  if (cfg.containsKey("moistureLow"))  rule.moistureLow  = cfg["moistureLow"].as<float>();
  if (cfg.containsKey("moistureHigh")) rule.moistureHigh = cfg["moistureHigh"].as<float>();
  if (cfg.containsKey("rainSkipMm"))   rule.rainSkipMm   = cfg["rainSkipMm"].as<float>();
  if (cfg.containsKey("windowStart"))  rule.windowStart  = cfg["windowStart"].as<int>();
  if (cfg.containsKey("windowEnd"))    rule.windowEnd    = cfg["windowEnd"].as<int>();
  if (cfg.containsKey("maxRunMin"))    rule.maxRunMin    = cfg["maxRunMin"].as<int>();
  Serial.printf("[config] rule low=%.0f high=%.0f rainSkip=%.1f\n",
                rule.moistureLow, rule.moistureHigh, rule.rainSkipMm);
}

/**
 * @brief MQTT subscribe callback — config push + manual valve override.
 * @param topic   Full topic string.
 * @param payload Raw JSON bytes.
 * @param len     Payload length.
 */
void onMqtt(char* topic, byte* payload, unsigned int len) {
  StaticJsonDocument<384> doc;
  if (deserializeJson(doc, payload, len)) return;
  String t = String(topic);
  if (t.endsWith("/cmd/gateway/config")) {
    applyConfig(doc);
  } else if (t.indexOf("/cmd/zone/") >= 0 && t.endsWith("/valve")) {
    bool open = doc["open"] | false;
    int ttl   = doc["ttlSec"] | 600;        // manual override window
    autoMode = false; manualUntil = millis() + (uint32_t) ttl * 1000;
    setRelay(open);
    Serial.printf("[cmd] manual valve %s (ttl %ds)\n", open ? "OPEN" : "CLOSE", ttl);
  }
}

/**
 * @brief Connect to the broker (username=serial, LWT=offline) and subscribe to cmd/#.
 * @return true on a successful connection.
 */
bool mqttConnect() {
  if (!gProvisioned) return false;
  mqtt.setServer(gMqttHost.c_str(), gMqttPort);
  mqtt.setBufferSize(1024);
  mqtt.setCallback(onMqtt);
  String willTopic = gTopicPrefix + "/telemetry/gateway/health";
  // username = serial, password = secret (broker ACL maps device → its subtree)
  if (mqtt.connect(gSerial.c_str(), gSerial.c_str(), gSecret.c_str(),
                   willTopic.c_str(), 1, true, "{\"status\":\"offline\"}")) {
    mqtt.subscribe((gTopicPrefix + "/cmd/#").c_str(), 1);
    Serial.println("[mqtt] connected + subscribed");
    return true;
  }
  Serial.printf("[mqtt] connect failed rc=%d\n", mqtt.state());
  return false;
}

/**
 * @brief Publish a JSON document to `{topicPrefix}{sub}`.
 * @param sub    Topic suffix, e.g. "/telemetry/zone/1".
 * @param doc    Payload document.
 * @param retain MQTT retain flag.
 */
void publish(const String& sub, const JsonDocument& doc, bool retain = false) {
  String topic = gTopicPrefix + sub;
  char buf[512]; size_t n = serializeJson(doc, buf, sizeof(buf));
  mqtt.publish(topic.c_str(), (const uint8_t*) buf, n, retain);
}

// ── Control loop (edge-first; same logic as the cloud + digital twin) ────────
/**
 * @brief Edge irrigation decision (auto mode): rain-skip → window → moisture
 *        hysteresis → max-run safety, then drive the relay.
 * @param soil    Latest soil reading.
 * @param raining Digital rain flag (LM393).
 * @param rain1h  Recent rainfall estimate (mm) for the rain-skip rule.
 */
void controlLoop(const Soil& soil, bool raining, float rain1h) {
  // Manual override expiry → back to auto.
  if (!autoMode && millis() > manualUntil) { autoMode = true; Serial.println("[ctrl] manual expired → auto"); }
  if (!autoMode) return;                                  // honor manual state

  int hour = (millis() / 3600000UL) % 24;                // crude clock (no RTC)
  bool want = valveOpen;
  if (rain1h >= rule.rainSkipMm || raining)      want = false;            // rain-skip
  else if (!(hour >= rule.windowStart && hour < rule.windowEnd)) want = false; // window
  else if (soil.valid && soil.moisture < rule.moistureLow)  want = true;  // irrigate
  else if (soil.valid && soil.moisture > rule.moistureHigh) want = false; // target reached

  // Safety max-run.
  if (want && valveOpen && (millis() - valveOpenedAt) > (uint32_t) rule.maxRunMin * 60000UL) {
    want = false;
    Serial.println("[ctrl] MAX-RUN safety cutoff");
  }
  if (want != valveOpen) setRelay(want);
}

/**
 * @brief Convert accumulated YF-S201 pulses to flow rate (K = 7.5 Hz per L/min).
 * @return Flow in L/min since the previous call.
 */
float computeFlowLpm() {
  noInterrupts(); uint32_t p = flowPulses; flowPulses = 0; interrupts();
  return (p / (PUBLISH_INTERVAL_MS / 1000.0f)) / FLOW_K_HZ_PER_LPM;
}

/**
 * @brief Detect a dry line: valve open but flow≈0 for several cycles → alert +
 *        fail-safe stop of the pump.
 * @param flowLpm Current flow rate in L/min.
 */
void checkLeak(float flowLpm) {
  // Valve commanded OPEN but ~no flow for several cycles → blockage/leak alert.
  if (valveOpen && flowLpm < 0.2f) {
    if (++leakCycles >= LEAK_GRACE_CYCLES) {
      StaticJsonDocument<192> a;
      a["type"] = "valve_no_flow"; a["severity"] = "critical";
      a["message"] = "Valve open but no flow detected — check pump/line.";
      publish("/state/zone/1", a);
      leakCycles = 0;
      setRelay(false);                  // fail-safe: stop the dry-running pump
      Serial.println("[leak] no-flow → safety stop + alert");
    }
  } else {
    leakCycles = 0;
  }
}

// ── Setup ────────────────────────────────────────────────────────────────────
/** @brief Arduino setup: init pins, Modbus, DHT, the flow ISR; load config; connect WiFi. */
void setup() {
  Serial.begin(115200); delay(300);
  pinMode(PIN_RS485_DE_RE, OUTPUT); digitalWrite(PIN_RS485_DE_RE, LOW);
  pinMode(PIN_RELAY, OUTPUT); digitalWrite(PIN_RELAY, HIGH); // relay OFF (active-low)
  pinMode(PIN_RAIN_DO, INPUT);
  pinMode(PIN_FLOW, INPUT_PULLUP);
  attachInterrupt(digitalPinToInterrupt(PIN_FLOW), flowISR, RISING);
  dht.begin();
  Serial2.begin(BAUD_RS485, SERIAL_8N1, PIN_RS485_RX, PIN_RS485_TX);
  node.begin(MODBUS_ADDR, Serial2);
  node.preTransmission(preTx); node.postTransmission(postTx);

  loadConfig();
  Serial.printf("[teranode] %s fw %s\n", gSerial.c_str(), FW_VERSION);
  connectWifi();
}

// ── Loop ─────────────────────────────────────────────────────────────────────
/**
 * @brief Arduino main loop: keep WiFi/provisioning/MQTT alive, run the control
 *        loop, and publish telemetry + weather + health on their cadences.
 */
void loop() {
  uint32_t now = millis();

  // Keep WiFi + provisioning + MQTT alive.
  if (WiFi.status() != WL_CONNECTED) connectWifi(8000);
  if (WiFi.status() == WL_CONNECTED && !gProvisioned && now - lastProvision > PROVISION_RETRY_MS) {
    lastProvision = now; provision();
  }
  if (gProvisioned && !mqtt.connected() && WiFi.status() == WL_CONNECTED) mqttConnect();
  if (mqtt.connected()) mqtt.loop();

  // Read sensors + run the control loop on the control cadence.
  static Soil soil; static float airTemp = 0, airHum = 0, rainAo = 0; static bool raining = false; static float flowLpm = 0;
  if (now - lastControl >= CONTROL_INTERVAL_MS) {
    lastControl = now;
    soil    = readSoil();
    airTemp = dht.readTemperature(); if (isnan(airTemp)) airTemp = NAN;
    airHum  = dht.readHumidity();    if (isnan(airHum))  airHum  = NAN;
    raining = digitalRead(PIN_RAIN_DO) == LOW;        // LM393 active-low
    rainAo  = analogRead(PIN_RAIN_AO) / 4095.0f;      // 0..1 intensity proxy
    float rain1h = raining ? 5.0f : 0.0f;             // coarse; replace w/ tipping-bucket accumulator
    controlLoop(soil, raining, rain1h);
  }

  // Publish telemetry.
  if (mqtt.connected() && now - lastPublish >= PUBLISH_INTERVAL_MS) {
    lastPublish = now;
    flowLpm = computeFlowLpm();
    checkLeak(flowLpm);

    if (soil.valid) {
      StaticJsonDocument<384> z;
      z["moisture"] = soil.moisture; z["soilTemp"] = soil.soilTemp;
      z["ec"] = soil.ecMScm; z["ph"] = soil.pH;
      z["n"] = soil.n; z["p"] = soil.p; z["k"] = soil.k;
      z["valve"] = valveOpen; z["pump"] = pumpOn; z["mode"] = autoMode ? "auto" : "manual";
      publish("/telemetry/zone/1", z);
    }
    StaticJsonDocument<256> w;
    if (!isnan(airTemp)) w["airTemp"] = airTemp;
    if (!isnan(airHum))  w["humidity"] = airHum;
    w["rain"] = raining ? 1 : 0; w["rainIntensity"] = rainAo; w["flow"] = flowLpm;
    publish("/telemetry/weather", w);

    // retained reported valve state (desired-vs-reported)
    StaticJsonDocument<128> st; st["valve"] = valveOpen; st["pump"] = pumpOn;
    publish("/state/zone/1", st, true);
  }

  // Heartbeat.
  if (mqtt.connected() && now - lastHealth >= HEALTH_INTERVAL_MS) {
    lastHealth = now;
    StaticJsonDocument<192> h;
    h["status"] = "online"; h["fwVersion"] = FW_VERSION;
    h["rssi"] = WiFi.RSSI(); h["uptimeS"] = now / 1000;
    publish("/telemetry/gateway/health", h, true);
  }
}
