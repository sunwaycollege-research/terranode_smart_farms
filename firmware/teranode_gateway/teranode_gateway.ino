/**
 * @file teranode_gateway.ino
 * @brief TERANODE connected ESP32 field gateway.
 *
 * Reads a 7-in-1 RS485 soil probe (falls back to analog pin 34) + DHT22 +
 * rain sensor + YF-S201 flow meter, runs an offline-first edge irrigation
 * control loop, and syncs to the TERANODE cloud over MQTT.
 *
 * Device-id-first model: the unit knows only { serial, secret }, calls
 * POST /provision, then publishes telemetry on teranode/dev/<serial>/...
 */

#include <Arduino.h>
#include <WiFi.h>
#include <HTTPClient.h>
#include <Preferences.h>
#include <PubSubClient.h>
#include <ArduinoJson.h>
#include <ModbusMaster.h>
#include <DHT.h>

// ── Device identity ──────────────────────────────────────────────────────────
#define DEVICE_SERIAL_DEFAULT  "TN-ESP32-BHUWAN"
#define DEVICE_SECRET_DEFAULT  "tn-bhuwan-sim-2026"
#define API_BASE_DEFAULT       "http://10.59.10.5:4000"
#define MQTT_HOST_DEFAULT      "10.59.10.5"
#define WIFI_SSID_DEFAULT      "SunwayForAI"
#define WIFI_PASS_DEFAULT      "Sunway@123"
#define FW_VERSION             "1.0.0"

// ── Pins ─────────────────────────────────────────────────────────────────────
#define PIN_RS485_DE_RE  14
#define PIN_RS485_TX     17
#define PIN_RS485_RX     16
#define PIN_DHT22        18
#define PIN_RAIN_DO      19
#define PIN_RAIN_AO      25
#define PIN_FLOW         21
#define PIN_RELAY        22
#define PIN_SOIL_ANALOG  34   // analog capacitive sensor fallback

// ── Constants ────────────────────────────────────────────────────────────────
#define DHTTYPE             DHT22
#define MODBUS_ADDR         1
#define BAUD_RS485          9600
#define PUBLISH_INTERVAL_MS 5000UL
#define CONTROL_INTERVAL_MS 10000UL
#define HEALTH_INTERVAL_MS  30000UL
#define PROVISION_RETRY_MS  30000UL
#define FLOW_K_HZ_PER_LPM   7.5f
#define LEAK_GRACE_CYCLES   3
#define ANALOG_AIR_VALUE    3330
#define ANALOG_WATER_VALUE  1250

// ── Structs (must be declared before any function that uses them) ─────────────
/** @brief One decoded soil reading; valid=false means sensor error. */
struct Soil {
  float moisture, soilTemp, ecMScm, pH, n, p, k;
  bool  valid;
};

/** @brief Edge irrigation rule; overridden by the cloud config push. */
struct Rule {
  float moistureLow  = 45.0f;
  float moistureHigh = 70.0f;
  float rainSkipMm   = 3.0f;
  int   windowStart  = 5;
  int   windowEnd    = 19;
  int   maxRunMin    = 90;
};

// ── Globals ──────────────────────────────────────────────────────────────────
Preferences  prefs;
ModbusMaster node;
DHT          dht(PIN_DHT22, DHTTYPE);
WiFiClient   netClient;
PubSubClient mqtt(netClient);

String   gSerial, gSecret, gApiBase, gWifiSsid, gWifiPass;
String   gTopicPrefix;
String   gMqttHost;
uint16_t gMqttPort    = 1883;
bool     gProvisioned = false;

Rule     rule;
bool     valveOpen    = false;
bool     pumpOn       = false;
bool     autoMode     = true;
uint32_t manualUntil  = 0;
uint32_t valveOpenedAt = 0;
int      leakCycles   = 0;

volatile uint32_t flowPulses = 0;
void IRAM_ATTR flowISR() { flowPulses = flowPulses + 1; }  // ++ deprecated on volatile

uint32_t lastPublish = 0, lastControl = 0, lastHealth = 0, lastProvision = 0;

// ── RS485 helpers ─────────────────────────────────────────────────────────────
void preTx()  { digitalWrite(PIN_RS485_DE_RE, HIGH); }
void postTx() { digitalWrite(PIN_RS485_DE_RE, LOW);  }

// ── Soil read (RS485 → analog fallback) ──────────────────────────────────────
/**
 * @brief Read all 7 soil values. Falls back to analog pin 34 if RS485 fails.
 * @return Decoded Soil; valid=true even on fallback (moisture only).
 */
Soil readSoil() {
  Soil s = {0, 0, 0, 0, 0, 0, 0, false};

  uint8_t r = node.readHoldingRegisters(0x0000, 7);
  if (r == node.ku8MBSuccess) {
    s.soilTemp = node.getResponseBuffer(0) / 10.0f;   // reg0 Temperature °C×10
    s.moisture = node.getResponseBuffer(1) / 10.0f;   // reg1 Moisture %×10
    s.ecMScm   = node.getResponseBuffer(2) / 1000.0f; // reg2 EC µS/cm → mS/cm
    s.pH       = node.getResponseBuffer(3) / 100.0f;  // reg3 pH raw/100
    s.n        = node.getResponseBuffer(4);
    s.p        = node.getResponseBuffer(5);
    s.k        = node.getResponseBuffer(6);
    s.valid    = true;
  } else {
    // RS485 probe not available — use the capacitive analog sensor on pin 34.
    Serial.printf("[modbus] err 0x%02X → analog fallback pin %d\n", r, PIN_SOIL_ANALOG);
    int raw = analogRead(PIN_SOIL_ANALOG);
    int pct = map(raw, ANALOG_AIR_VALUE, ANALOG_WATER_VALUE, 0, 100);
    pct = constrain(pct, 0, 100);
    s.moisture = (float) pct;
    s.valid    = true;
    Serial.printf("[analog] raw=%d  moisture=%.0f%%\n", raw, s.moisture);
  }
  return s;
}

// ── Relay ─────────────────────────────────────────────────────────────────────
void setRelay(bool on) {
  valveOpen = on;
  pumpOn    = on;
  digitalWrite(PIN_RELAY, on ? LOW : HIGH);
  if (on) valveOpenedAt = millis();
}

// ── WiFi ─────────────────────────────────────────────────────────────────────
void loadConfig() {
  prefs.begin("teranode", false);
  gSerial   = prefs.getString("serial", DEVICE_SERIAL_DEFAULT);
  gSecret   = prefs.getString("secret", DEVICE_SECRET_DEFAULT);
  gApiBase  = prefs.getString("api",    API_BASE_DEFAULT);
  gWifiSsid = prefs.getString("ssid",   WIFI_SSID_DEFAULT);
  gWifiPass = prefs.getString("pass",   WIFI_PASS_DEFAULT);
  prefs.end();
}

bool connectWifi(uint32_t timeoutMs = 20000) {
  if (gWifiSsid.isEmpty()) {
    Serial.println("[wifi] no credentials — waiting");
    return false;
  }
  WiFi.mode(WIFI_STA);
  WiFi.begin(gWifiSsid.c_str(), gWifiPass.c_str());
  uint32_t start = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - start < timeoutMs) delay(250);
  bool ok = WiFi.status() == WL_CONNECTED;
  Serial.printf("[wifi] %s  IP=%s\n", ok ? "connected" : "FAILED", WiFi.localIP().toString().c_str());
  return ok;
}

// ── Provisioning ─────────────────────────────────────────────────────────────
bool provision() {
  if (WiFi.status() != WL_CONNECTED) return false;
  HTTPClient http;
  http.begin(gApiBase + "/provision");
  http.addHeader("Content-Type", "application/json");

  JsonDocument req;
  req["serial"]    = gSerial;
  req["secret"]    = gSecret;
  req["fwVersion"] = FW_VERSION;
  req["wifiSsid"]  = gWifiSsid;
  JsonObject caps = req["capabilities"].to<JsonObject>();
  JsonArray  ch   = caps["channels"].to<JsonArray>();
  ch.add("moisture"); ch.add("soiltemp"); ch.add("ec"); ch.add("ph");
  ch.add("n"); ch.add("p"); ch.add("k");
  ch.add("airtemp"); ch.add("humidity"); ch.add("rain"); ch.add("flow");
  caps["zones"] = 1;
  caps["pump"]  = true;

  String body;
  serializeJson(req, body);
  int    code = http.POST(body);
  String resp = http.getString();
  http.end();
  Serial.printf("[provision] HTTP %d  %s\n", code, resp.c_str());

  if (code == 202) return false;
  if (code != 200) return false;

  JsonDocument res;
  if (deserializeJson(res, resp)) return false;

  const char* mqttUrl = res["mqttUrl"] | "mqtt://" MQTT_HOST_DEFAULT ":1883";
  gTopicPrefix = String((const char*)(res["topicPrefix"] | ""));
  String mu = String(mqttUrl);
  mu.replace("mqtt://", "");
  int colon = mu.indexOf(':');
  gMqttHost = colon > 0 ? mu.substring(0, colon) : mu;
  gMqttPort = colon > 0 ? (uint16_t)mu.substring(colon + 1).toInt() : 1883;
  if (gTopicPrefix.isEmpty()) gTopicPrefix = "teranode/dev/" + gSerial;
  gProvisioned = true;
  Serial.printf("[provision] linked → %s @ %s:%u\n", gTopicPrefix.c_str(), gMqttHost.c_str(), gMqttPort);
  return true;
}

// ── MQTT ─────────────────────────────────────────────────────────────────────
void applyConfig(const JsonDocument& cfg) {
  if (!cfg["moistureLow"].isNull())  rule.moistureLow  = cfg["moistureLow"].as<float>();
  if (!cfg["moistureHigh"].isNull()) rule.moistureHigh = cfg["moistureHigh"].as<float>();
  if (!cfg["rainSkipMm"].isNull())   rule.rainSkipMm   = cfg["rainSkipMm"].as<float>();
  if (!cfg["windowStart"].isNull())  rule.windowStart  = cfg["windowStart"].as<int>();
  if (!cfg["windowEnd"].isNull())    rule.windowEnd    = cfg["windowEnd"].as<int>();
  if (!cfg["maxRunMin"].isNull())    rule.maxRunMin    = cfg["maxRunMin"].as<int>();
  Serial.printf("[config] low=%.0f high=%.0f rainSkip=%.1f\n",
                rule.moistureLow, rule.moistureHigh, rule.rainSkipMm);
}

void onMqtt(char* topic, byte* payload, unsigned int len) {
  JsonDocument doc;
  if (deserializeJson(doc, payload, len)) return;
  String t = String(topic);
  if (t.endsWith("/cmd/gateway/config")) {
    applyConfig(doc);
  } else if (t.indexOf("/cmd/zone/") >= 0 && t.endsWith("/valve")) {
    bool open = doc["open"] | false;
    int  ttl  = doc["ttlSec"] | 600;
    autoMode    = false;
    manualUntil = millis() + (uint32_t)ttl * 1000;
    setRelay(open);
    Serial.printf("[cmd] manual valve %s  ttl=%ds\n", open ? "OPEN" : "CLOSE", ttl);
  }
}

bool mqttConnect() {
  if (!gProvisioned) return false;
  mqtt.setServer(gMqttHost.c_str(), gMqttPort);
  mqtt.setBufferSize(1024);
  mqtt.setCallback(onMqtt);
  String willTopic = gTopicPrefix + "/telemetry/gateway/health";
  if (mqtt.connect(gSerial.c_str(), gSerial.c_str(), gSecret.c_str(),
                   willTopic.c_str(), 1, true, "{\"status\":\"offline\"}")) {
    mqtt.subscribe((gTopicPrefix + "/cmd/#").c_str(), 1);
    Serial.println("[mqtt] connected + subscribed");
    return true;
  }
  Serial.printf("[mqtt] failed rc=%d\n", mqtt.state());
  return false;
}

void publish(const String& sub, const JsonDocument& doc, bool retain = false) {
  String topic = gTopicPrefix + sub;
  char   buf[512];
  size_t n = serializeJson(doc, buf, sizeof(buf));
  mqtt.publish(topic.c_str(), (const uint8_t*)buf, n, retain);
}

// ── Control loop ─────────────────────────────────────────────────────────────
void controlLoop(const Soil& soil, bool raining, float rain1h) {
  if (!autoMode && millis() > manualUntil) {
    autoMode = true;
    Serial.println("[ctrl] manual expired → auto");
  }
  if (!autoMode) return;

  int  hour = (millis() / 3600000UL) % 24;
  bool want = valveOpen;
  if (rain1h >= rule.rainSkipMm || raining)
    want = false;
  else if (!(hour >= rule.windowStart && hour < rule.windowEnd))
    want = false;
  else if (soil.valid && soil.moisture < rule.moistureLow)
    want = true;
  else if (soil.valid && soil.moisture > rule.moistureHigh)
    want = false;

  if (want && valveOpen &&
      (millis() - valveOpenedAt) > (uint32_t)rule.maxRunMin * 60000UL) {
    want = false;
    Serial.println("[ctrl] MAX-RUN safety cutoff");
  }
  if (want != valveOpen) setRelay(want);
}

float computeFlowLpm() {
  noInterrupts();
  uint32_t p = flowPulses;
  flowPulses  = 0;
  interrupts();
  return (p / (PUBLISH_INTERVAL_MS / 1000.0f)) / FLOW_K_HZ_PER_LPM;
}

void checkLeak(float flowLpm) {
  if (valveOpen && flowLpm < 0.2f) {
    if (++leakCycles >= LEAK_GRACE_CYCLES) {
      JsonDocument a;
      a["type"]     = "valve_no_flow";
      a["severity"] = "critical";
      a["message"]  = "Valve open but no flow — check pump/line.";
      publish("/state/zone/1", a);
      leakCycles = 0;
      setRelay(false);
      Serial.println("[leak] no-flow → safety stop");
    }
  } else {
    leakCycles = 0;
  }
}

// ── Setup ─────────────────────────────────────────────────────────────────────
void setup() {
  Serial.begin(115200);
  delay(300);

  pinMode(PIN_RS485_DE_RE, OUTPUT); digitalWrite(PIN_RS485_DE_RE, LOW);
  pinMode(PIN_RELAY,       OUTPUT); digitalWrite(PIN_RELAY, HIGH); // active-LOW → OFF
  pinMode(PIN_RAIN_DO,     INPUT);
  pinMode(PIN_FLOW,        INPUT_PULLUP);
  pinMode(PIN_SOIL_ANALOG, INPUT);
  attachInterrupt(digitalPinToInterrupt(PIN_FLOW), flowISR, RISING);

  dht.begin();
  Serial2.begin(BAUD_RS485, SERIAL_8N1, PIN_RS485_RX, PIN_RS485_TX);
  node.begin(MODBUS_ADDR, Serial2);
  node.preTransmission(preTx);
  node.postTransmission(postTx);

  loadConfig();
  Serial.printf("[teranode] %s  fw %s\n", gSerial.c_str(), FW_VERSION);
  connectWifi();
}

// ── Loop ─────────────────────────────────────────────────────────────────────
void loop() {
  uint32_t now = millis();

  if (WiFi.status() != WL_CONNECTED) connectWifi(8000);
  if (WiFi.status() == WL_CONNECTED && !gProvisioned &&
      now - lastProvision > PROVISION_RETRY_MS) {
    lastProvision = now;
    provision();
  }
  if (gProvisioned && !mqtt.connected() && WiFi.status() == WL_CONNECTED)
    mqttConnect();
  if (mqtt.connected()) mqtt.loop();

  static Soil  soil;
  static float airTemp = 0, airHum = 0, rainAo = 0, flowLpm = 0;
  static bool  raining = false;

  if (now - lastControl >= CONTROL_INTERVAL_MS) {
    lastControl = now;
    soil    = readSoil();
    airTemp = dht.readTemperature(); if (isnan(airTemp)) airTemp = 0;
    airHum  = dht.readHumidity();    if (isnan(airHum))  airHum  = 0;
    raining = digitalRead(PIN_RAIN_DO) == LOW;
    rainAo  = analogRead(PIN_RAIN_AO) / 4095.0f;
    float rain1h = raining ? 5.0f : 0.0f;
    controlLoop(soil, raining, rain1h);
  }

  if (mqtt.connected() && now - lastPublish >= PUBLISH_INTERVAL_MS) {
    lastPublish = now;
    flowLpm = computeFlowLpm();
    checkLeak(flowLpm);

    if (soil.valid) {
      JsonDocument z;
      z["moisture"] = soil.moisture;
      z["soilTemp"] = soil.soilTemp;
      z["ec"]       = soil.ecMScm;
      z["ph"]       = soil.pH;
      z["n"]        = soil.n;
      z["p"]        = soil.p;
      z["k"]        = soil.k;
      z["valve"]    = valveOpen;
      z["pump"]     = pumpOn;
      z["mode"]     = autoMode ? "auto" : "manual";
      publish("/telemetry/zone/1", z);
    }

    JsonDocument w;
    if (airTemp != 0) w["airTemp"]  = airTemp;
    if (airHum  != 0) w["humidity"] = airHum;
    w["rain"]          = raining ? 1 : 0;
    w["rainIntensity"] = rainAo;
    w["flow"]          = flowLpm;
    publish("/telemetry/weather", w);

    JsonDocument st;
    st["valve"] = valveOpen;
    st["pump"]  = pumpOn;
    publish("/state/zone/1", st, true);
  }

  if (mqtt.connected() && now - lastHealth >= HEALTH_INTERVAL_MS) {
    lastHealth = now;
    JsonDocument h;
    h["status"]     = "online";
    h["fwVersion"]  = FW_VERSION;
    h["rssi"]       = WiFi.RSSI();
    h["uptimeS"]    = now / 1000;
    publish("/telemetry/gateway/health", h, true);
  }
}
