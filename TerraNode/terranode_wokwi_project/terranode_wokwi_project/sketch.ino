#include <Wire.h>
#include <Adafruit_GFX.h>
#include <Adafruit_SSD1306.h>
#include "DHTesp.h"

// ---------- TerraNode Wokwi Simulation ----------
// Real TerraNode parts like RS485 7-in-1 soil sensor, pump, valve and relay
// are simulated using potentiometers, switches and LEDs.

#define DHT_PIN 18
#define RAIN_PIN 19

#define MOISTURE_PIN 34
#define PH_PIN 35
#define EC_PIN 32
#define N_PIN 33
#define P_PIN 36
#define K_PIN 39

#define PUMP_PIN 26
#define VALVE_PIN 27
#define RELAY_PIN 14

#define SCREEN_WIDTH 128
#define SCREEN_HEIGHT 64

Adafruit_SSD1306 display(SCREEN_WIDTH, SCREEN_HEIGHT, &Wire, -1);
DHTesp dht;

int moistureThreshold = 40;   // below this = dry soil
int phLow = 6;
int phHigh = 7;

float mapFloat(int x, int in_min, int in_max, float out_min, float out_max) {
  return (float)(x - in_min) * (out_max - out_min) / (float)(in_max - in_min) + out_min;
}

void setup() {
  Serial.begin(115200);

  pinMode(RAIN_PIN, INPUT);
  pinMode(PUMP_PIN, OUTPUT);
  pinMode(VALVE_PIN, OUTPUT);
  pinMode(RELAY_PIN, OUTPUT);

  digitalWrite(PUMP_PIN, LOW);
  digitalWrite(VALVE_PIN, LOW);
  digitalWrite(RELAY_PIN, LOW);

  dht.setup(DHT_PIN, DHTesp::DHT22);

  // ESP32 default I2C pins: SDA = GPIO21, SCL = GPIO22
  Wire.begin(21, 22);

  if (!display.begin(SSD1306_SWITCHCAPVCC, 0x3C)) {
    Serial.println("OLED failed. Check SDA/SCL/VCC/GND.");
    while (true) {
      delay(100);
    }
  }

  display.clearDisplay();
  display.setTextColor(SSD1306_WHITE);
  display.setTextSize(1);
  display.setCursor(0, 0);
  display.println("TerraNode MVP");
  display.println("Wokwi Simulation");
  display.println("Starting...");
  display.display();
  delay(1500);
}

void loop() {
  int rawMoisture = analogRead(MOISTURE_PIN);
  int rawPH = analogRead(PH_PIN);
  int rawEC = analogRead(EC_PIN);
  int rawN = analogRead(N_PIN);
  int rawP = analogRead(P_PIN);
  int rawK = analogRead(K_PIN);

  int moisturePercent = map(rawMoisture, 0, 4095, 0, 100);
  float phValue = mapFloat(rawPH, 0, 4095, 4.0, 9.0);
  float ecValue = mapFloat(rawEC, 0, 4095, 0.0, 5.0);
  int nitrogen = map(rawN, 0, 4095, 0, 200);
  int phosphorus = map(rawP, 0, 4095, 0, 200);
  int potassium = map(rawK, 0, 4095, 0, 200);

  // Slide switch: HIGH = rain detected, LOW = no rain
  bool rainDetected = digitalRead(RAIN_PIN) == HIGH;

  TempAndHumidity dhtData = dht.getTempAndHumidity();

  bool soilDry = moisturePercent < moistureThreshold;
  bool irrigationOn = soilDry && !rainDetected;

  digitalWrite(PUMP_PIN, irrigationOn ? HIGH : LOW);
  digitalWrite(VALVE_PIN, irrigationOn ? HIGH : LOW);
  digitalWrite(RELAY_PIN, irrigationOn ? HIGH : LOW);

  Serial.println("========== TerraNode ==========");
  Serial.print("Moisture: "); Serial.print(moisturePercent); Serial.println(" %");
  Serial.print("Rain: "); Serial.println(rainDetected ? "YES" : "NO");
  Serial.print("Temperature: "); Serial.print(dhtData.temperature, 1); Serial.println(" C");
  Serial.print("Humidity: "); Serial.print(dhtData.humidity, 1); Serial.println(" %");
  Serial.print("pH: "); Serial.println(phValue, 1);
  Serial.print("EC: "); Serial.print(ecValue, 2); Serial.println(" mS/cm");
  Serial.print("N/P/K: ");
  Serial.print(nitrogen); Serial.print("/");
  Serial.print(phosphorus); Serial.print("/");
  Serial.println(potassium);
  Serial.print("Irrigation: "); Serial.println(irrigationOn ? "ON" : "OFF");

  display.clearDisplay();
  display.setTextSize(1);
  display.setCursor(0, 0);
  display.println("TerraNode MVP");
  display.print("M:"); display.print(moisturePercent); display.print("% ");
  display.print("Rain:"); display.println(rainDetected ? "Y" : "N");

  display.print("T:"); display.print(dhtData.temperature, 1); display.print("C ");
  display.print("H:"); display.print(dhtData.humidity, 0); display.println("%");

  display.print("pH:"); display.print(phValue, 1);
  display.print(" EC:"); display.println(ecValue, 1);

  display.print("NPK:");
  display.print(nitrogen); display.print("/");
  display.print(phosphorus); display.print("/");
  display.println(potassium);

  display.print("Pump:"); display.print(irrigationOn ? "ON " : "OFF");
  display.print(" Valve:"); display.println(irrigationOn ? "ON" : "OFF");

  if (phValue < phLow || phValue > phHigh) {
    display.println("pH check needed");
  } else if (irrigationOn) {
    display.println("Irrigating...");
  } else {
    display.println("System stable");
  }

  display.display();
  delay(1000);
}
