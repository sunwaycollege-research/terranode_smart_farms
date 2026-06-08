/**
 * @file sketch.ino
 * @brief TERANODE base ESP32 edge template (Wokwi-runnable).
 *
 * The minimal sensor + WiFi/MQTT template the connected gateway
 * (teranode_gateway.ino) builds on. Runs on Wokwi with the bundled
 * diagram.json. See docs: components/firmware.
 */
/* =====================================================================
   TERANODE — IoT edge simulation (ESP32 gateway/zone node)
   Runs on Wokwi: https://wokwi.com  (paste diagram.json + this sketch)

   What this simulates (maps to 02-IoT-Hardware-and-Firmware.md):
     • ESP32 = the gateway "brain" (primary; Raspberry Pi is optional in the design)
     • Sensors:  capacitive soil moisture, pH (BNC+amp via ADS1115), NPK (RS485),
                 DHT22 (air temp/humidity), DS18B20 (soil temp), tipping-bucket rain
     • Actuators: zone solenoid VALVE, main PUMP, fertigation DOSING (shown as LEDs)
     • Control logic (§6): per-zone moisture hysteresis + rain-skip + schedule window
                           + central fertigation dosing + safety max-run timeout
     • Telemetry: a JSON line is printed to Serial every 2 s in the exact shape that
                  would be published to MQTT  teranode/{org}/{farm}/{gw}/telemetry/zone/1
     • Local HMI: 16x2 I2C LCD = the on-site display (like the reference build)

   Wokwi controls while it runs:
     • Drag the 3 potentiometers to set Soil Moisture / pH / NPK
     • Click the DHT22 / DS18B20 to change air & soil temperature/humidity
     • Press the RAIN TIP button to add rainfall (each press = one bucket tip = 0.2 mm)
   Watch the LEDs and Serial Monitor to see the valve/pump/dosing decisions.
   ===================================================================== */

// ---- Toggle any sensor off (set 0) if its library won't compile; it then uses a sim value
#define USE_DHT       1
#define USE_DS18B20   1
#define USE_LCD       1

#if USE_DHT
  #include <DHTesp.h>
  DHTesp dht;
#endif
#if USE_DS18B20
  #include <OneWire.h>
  #include <DallasTemperature.h>
  OneWire oneWire(4);
  DallasTemperature ds(&oneWire);
#endif
#if USE_LCD
  #include <Wire.h>
  #include <LiquidCrystal_I2C.h>
  LiquidCrystal_I2C lcd(0x27, 16, 2);
#endif

// ---------------- Pins ----------------
const int PIN_MOIST = 34;   // capacitive soil moisture  (ADC)
const int PIN_PH    = 35;   // pH amplifier output       (ADC, via ADS1115 in real HW)
const int PIN_NPK   = 32;   // NPK "N" proxy             (ADC; real HW = RS485/Modbus)
const int PIN_DHT   = 15;   // DHT22 data
const int PIN_RAIN  = 27;   // tipping-bucket reed switch (INPUT_PULLUP, pressed = LOW)
const int PIN_VALVE = 25;   // zone solenoid valve
const int PIN_PUMP  = 26;   // main pump
const int PIN_DOSE  = 33;   // fertigation dosing pump

// ---------------- Zone rules (pushed from cloud in the real system) ----------------
struct Rule { float low, high, rainSkipMM, ecTarget, phTarget; };
Rule rule = { 45.0, 70.0, 4.0, 1.8, 6.2 };
const int   WIN_START = 5;     // allowed irrigation window (hour)
const int   WIN_END   = 19;
const float MAX_RUN_MIN = 90;  // safety: max continuous valve-open minutes

// ---------------- Simulated clock ----------------
const unsigned long SIM_MS_PER_MIN = 150;   // 1 sim-minute every 150 ms (~3.6 min per sim-day)

// ---------------- State ----------------
bool  valveOpen = false, pumpOn = false, dosingOn = false;
float openMin = 0;                 // minutes valve has been continuously open
float rain1h = 0;                  // rolling rainfall estimate (mm in ~last hour)
float ec = 1.2, phShown = 6.6;     // EC/pH that dosing nudges toward targets
int   tipCount = 0;
bool  lastRainBtn = HIGH;
unsigned long lastLoop = 0, lastTelem = 0, lastLcd = 0;
String reason = "OK";
// alert edge-detect
bool aRainSkip = false, aMaxRun = false, aLowCrit = false, lcdToggle = false;

float clampf(float v, float lo, float hi){ return v < lo ? lo : (v > hi ? hi : v); }

void setup() {
  Serial.begin(115200);
  delay(200);
  pinMode(PIN_RAIN, INPUT_PULLUP);
  pinMode(PIN_VALVE, OUTPUT);
  pinMode(PIN_PUMP, OUTPUT);
  pinMode(PIN_DOSE, OUTPUT);
  analogReadResolution(12);                 // 0..4095 on ESP32
#if USE_DHT
  dht.setup(PIN_DHT, DHTesp::DHT22);
#endif
#if USE_DS18B20
  ds.begin();
#endif
#if USE_LCD
  Wire.begin(21, 22);
  lcd.init(); lcd.backlight();
  lcd.setCursor(0, 0); lcd.print("TERANODE  node");
  lcd.setCursor(0, 1); lcd.print("booting...");
#endif
  Serial.println(F("\n=== TERANODE edge node online (ESP32) ==="));
  Serial.println(F("Drag pots = moisture/pH/NPK | Press RAIN button = rainfall\n"));
  lastLoop = millis();
}

void pushAlert(const char* sev, const String& msg){
  Serial.print("[ALERT]["); Serial.print(sev); Serial.print("] "); Serial.println(msg);
}

void loop() {
  unsigned long now = millis();
  float dtSimMin = (now - lastLoop) / (float)SIM_MS_PER_MIN;
  lastLoop = now;

  // ---- simulated time of day ----
  unsigned long simMin = (now / SIM_MS_PER_MIN) % 1440UL;
  int hh = simMin / 60, mm = simMin % 60;
  char tbuf[6]; sprintf(tbuf, "%02d:%02d", hh, mm);

  // ---- read sensors ----
  int rawM = analogRead(PIN_MOIST);
  int rawP = analogRead(PIN_PH);
  int rawN = analogRead(PIN_NPK);
  float moisture = rawM * 100.0 / 4095.0;          // % (turn pot right = wetter)
  float phRaw    = 4.0 + (rawP / 4095.0) * 5.0;     // pH 4.0 .. 9.0
  float n        = rawN * 200.0 / 4095.0;           // mg/kg N
  float p        = n * 0.45, k = n * 1.30;          // rough P,K from N

  float airTemp = 26, humidity = 55, soilTemp = 21;
#if USE_DHT
  TempAndHumidity th = dht.getTempAndHumidity();
  if (!isnan(th.temperature)) airTemp = th.temperature;
  if (!isnan(th.humidity))    humidity = th.humidity;
#endif
#if USE_DS18B20
  ds.requestTemperatures();
  float st = ds.getTempCByIndex(0);
  if (st > -100) soilTemp = st;
#endif

  // ---- rain: each button press = one tipping-bucket tip (0.2 mm) ----
  bool rb = digitalRead(PIN_RAIN);
  if (lastRainBtn == HIGH && rb == LOW) { tipCount++; rain1h += 0.2 * 5; } // +1mm/press for visibility
  lastRainBtn = rb;
  rain1h = clampf(rain1h - 0.04 * dtSimMin, 0, 100);   // rolling decay

  // ---- fertigation chemistry (only nudges while dosing) ----
  if (dosingOn) {
    ec      += (rule.ecTarget - ec) * 0.04 * dtSimMin;
    phShown += (rule.phTarget - phShown) * 0.04 * dtSimMin;
  } else {
    phShown += (phRaw - phShown) * 0.1;                // track probe when not dosing
    ec      += (0.4 + n / 200.0 * 1.4 - ec) * 0.02;    // EC ~ nutrient load
  }

  // ---- CONTROL LOGIC (02 §6: hysteresis + rain-skip + window + safety) ----
  bool want;
  if (rain1h >= rule.rainSkipMM)            { want = false; reason = "RAIN-SKIP"; }
  else if (!(hh >= WIN_START && hh < WIN_END)) { want = false; reason = "OUTSIDE-WINDOW"; }
  else if (moisture < rule.low)             { want = true;  reason = "IRRIGATING (low moisture)"; }
  else if (moisture > rule.high)            { want = false; reason = "TARGET REACHED"; }
  else                                      { want = valveOpen; reason = valveOpen ? "IRRIGATING (band)" : "OK (in band)"; }

  // safety max-run
  if (want && openMin >= MAX_RUN_MIN)       { want = false; reason = "MAX-RUN STOP";
    if (!aMaxRun) { pushAlert("WARN", "Zone 1 valve hit max-run timeout -> closed (check sensor/flow)"); aMaxRun = true; }
  } else if (!want) aMaxRun = false;

  // ---- drive actuators ----
  valveOpen = want;
  pumpOn    = valveOpen;                 // pump runs whenever any zone valve is open
  dosingOn  = pumpOn;                    // central fertigation: dose only while pumping
  digitalWrite(PIN_VALVE, valveOpen);
  digitalWrite(PIN_PUMP,  pumpOn);
  digitalWrite(PIN_DOSE,  dosingOn);
  openMin = valveOpen ? openMin + dtSimMin : 0;

  // ---- edge-triggered alerts ----
  if (reason == "RAIN-SKIP" && !aRainSkip) { pushAlert("INFO", "Rain detected (" + String(rain1h,1) + " mm) -> irrigation skipped"); aRainSkip = true; }
  if (reason != "RAIN-SKIP") aRainSkip = false;
  if (moisture < rule.low - 8 && !aLowCrit) { pushAlert("WARN", "Zone 1 soil moisture critically low: " + String(moisture,0) + "%"); aLowCrit = true; }
  if (moisture > rule.low) aLowCrit = false;

  // ---- telemetry (MQTT payload shape) every 2 s ----
  if (now - lastTelem > 2000) {
    lastTelem = now;
    Serial.print("teranode/acme/farm1/gw1/telemetry/zone/1  ");
    Serial.print("{\"t\":\""); Serial.print(tbuf);
    Serial.print("\",\"moisture\":"); Serial.print(moisture, 0);
    Serial.print(",\"ph\":");        Serial.print(phShown, 2);
    Serial.print(",\"ec\":");        Serial.print(ec, 2);
    Serial.print(",\"n\":");         Serial.print(n, 0);
    Serial.print(",\"p\":");         Serial.print(p, 0);
    Serial.print(",\"k\":");         Serial.print(k, 0);
    Serial.print(",\"airTemp\":");   Serial.print(airTemp, 1);
    Serial.print(",\"humidity\":");  Serial.print(humidity, 0);
    Serial.print(",\"soilTemp\":");  Serial.print(soilTemp, 1);
    Serial.print(",\"rain_mm_1h\":");Serial.print(rain1h, 1);
    Serial.print(",\"valve\":");     Serial.print(valveOpen ? "true" : "false");
    Serial.print(",\"pump\":");      Serial.print(pumpOn ? "true" : "false");
    Serial.print(",\"dosing\":");    Serial.print(dosingOn ? "true" : "false");
    Serial.print(",\"mode\":\"auto\"}");
    Serial.print("   | "); Serial.println(reason);
  }

  // ---- local HMI (LCD) ----
#if USE_LCD
  if (now - lastLcd > 1500) {
    lastLcd = now; lcdToggle = !lcdToggle;
    char l0[17], l1[17];
    snprintf(l0, 17, "M:%2d%% pH:%4.1f  ", (int)moisture, phShown);
    if (lcdToggle)
      snprintf(l1, 17, "V:%s P:%s %s", valveOpen?"ON ":"off", pumpOn?"ON ":"off", dosingOn?"DOSE":"    ");
    else
      snprintf(l1, 17, "%-16s", reason.c_str());
    lcd.setCursor(0,0); lcd.print(l0);
    lcd.setCursor(0,1); lcd.print(l1);
  }
#endif

  delay(40);
}
