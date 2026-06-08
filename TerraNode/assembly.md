Step 1: Prepare (everything unpowered)
Unplug USB or battery. Clear the bench and keep the Pins tab open — every connection below follows that table. Board: ESP32 DevKit v1.

Components:

NBL-S-TMC-7 7-in-1 Soil Composite Sensor
RS485 to TTL Module (MAX485)
DHT22
Rain Sensor Module
YF-S201 Flow Sensor
12V DC Submersible Mini Water Pump
12V Solenoid Valve
Relay Module
Buck Converter
12V DC Power Supply
Tips
Use different wire colors for VCC, GND, and signals if you have them
Warnings
Do not power the board until wiring matches the pin map
Step 2: Wire NBL-S-TMC-7 7-in-1 Soil Composite Sensor
Wire NBL-S-TMC-7 7-in-1 Soil Composite Sensor (NBL-S-TMC-7_0) like this:
NBL-S-TMC-7 7-in-1 Soil Composite Sensor · VCC → 3V3 [power]
NBL-S-TMC-7 7-in-1 Soil Composite Sensor · GND → GND [ground]
NBL-S-TMC-7 7-in-1 Soil Composite Sensor · RS485-A → GPIO4 [digital]
NBL-S-TMC-7 7-in-1 Soil Composite Sensor · RS485-B → GPIO13 [digital]
Give each jumper a light tug so loose Dupont connectors show up now, not after flashing.

Components:

NBL-S-TMC-7 7-in-1 Soil Composite Sensor
Step 3: Wire RS485 to TTL Module (MAX485)
Wire RS485 to TTL Module (MAX485) (max485-rs485-ttl-module_1) like this:
RS485 to TTL Module (MAX485) · VCC → 5V [power]
RS485 to TTL Module (MAX485) · GND → GND [ground]
RS485 to TTL Module (MAX485) · TX → GPIO16 [uart]
RS485 to TTL Module (MAX485) · RX → GPIO17 [uart]
RS485 to TTL Module (MAX485) · DE_RE → GPIO14 [digital]
RS485 to TTL Module (MAX485) · A → external (RS485 bus A) [data]
RS485 to TTL Module (MAX485) · B → external (RS485 bus B) [data]
Give each jumper a light tug so loose Dupont connectors show up now, not after flashing.

Components:

RS485 to TTL Module (MAX485)
Step 4: Wire DHT22
Wire DHT22 (dht22_2) like this:
DHT22 · VCC → 3V3 [power]
DHT22 · GND → GND [ground]
DHT22 · DATA → GPIO18 [data]
Give each jumper a light tug so loose Dupont connectors show up now, not after flashing.

Components:

DHT22
Step 5: Wire Rain Sensor Module
Wire Rain Sensor Module (rain-sensor-module_3) like this:
Rain Sensor Module · VCC → 3V3 [power]
Rain Sensor Module · GND → GND [ground]
Rain Sensor Module · D0 → GPIO19 [digital]
Rain Sensor Module · A0 → GPIO25 [analog]
Give each jumper a light tug so loose Dupont connectors show up now, not after flashing.

Components:

Rain Sensor Module
Step 6: Wire YF-S201 Flow Sensor
Wire YF-S201 Flow Sensor (yf-s201-flow-sensor_4) like this:
YF-S201 Flow Sensor · Power → VCC [power]
YF-S201 Flow Sensor · Ground → GND [ground]
YF-S201 Flow Sensor · Signal → GPIO21 [digital]
Give each jumper a light tug so loose Dupont connectors show up now, not after flashing.

Components:

YF-S201 Flow Sensor
Step 7: Wire 12V DC Submersible Mini Water Pump
Wire 12V DC Submersible Mini Water Pump (12v-dc-submersible-mini-water-pump_5) like this:
12V DC Submersible Mini Water Pump · PUMP+ → external (External driver switched positive or supply positive) [data]
12V DC Submersible Mini Water Pump · PUMP- → external (External driver switched negative or supply return) [data]
Give each jumper a light tug so loose Dupont connectors show up now, not after flashing.

Components:

12V DC Submersible Mini Water Pump
Step 8: Wire 12V Solenoid Valve
Wire 12V Solenoid Valve (12v-solenoid-valve_6) like this:
12V Solenoid Valve · VCC → 3V3 [power]
12V Solenoid Valve · GND → GND [ground]
Give each jumper a light tug so loose Dupont connectors show up now, not after flashing.

Components:

12V Solenoid Valve
Step 9: Wire Relay Module
Wire Relay Module (relay-module_7) like this:
Relay Module · VCC → 5V [power]
Relay Module · GND → GND [ground]
Relay Module · IN → GPIO22 [digital]
Give each jumper a light tug so loose Dupont connectors show up now, not after flashing.

Components:

Relay Module
Step 10: Wire Buck Converter
Wire Buck Converter (buck-converter_8) like this:
Buck Converter · VCC → 3V3 [power]
Buck Converter · GND → GND [ground]
Give each jumper a light tug so loose Dupont connectors show up now, not after flashing.

Components:

Buck Converter
Step 11: Wire 12V DC Power Supply
Wire 12V DC Power Supply (12v-dc-power-supply_9) like this:
12V DC Power Supply · VCC → 3V3 [power]
12V DC Power Supply · GND → GND [ground]
Give each jumper a light tug so loose Dupont connectors show up now, not after flashing.

Components:

12V DC Power Supply
Step 12: Flash firmware with Schematik Deploy
Connect the board by USB. In Schematik, open Deploy and click Deploy to compile and flash the sketch to your board. Use Chrome or Edge for Web Serial. When the browser asks, choose your board's serial port.

Components:

NBL-S-TMC-7 7-in-1 Soil Composite Sensor
RS485 to TTL Module (MAX485)
DHT22
Rain Sensor Module
YF-S201 Flow Sensor
12V DC Submersible Mini Water Pump
12V Solenoid Valve
Relay Module
Buck Converter
12V DC Power Supply
Tips
Skim the Code tab before uploading
Schematik passes the listed libraries into the compile step for you
Deploy your sketch
Connect your board via USB, then hit deploy. Use Chrome or Edge for Web Serial support.

Deploy
Step 13: Power on and verify
After upload, the board resets and starts running the sketch. Open the serial monitor or watch the LEDs and sensors for the behavior the code describes — this is the fun first proof that the build is alive. If anything gets hot or smells wrong, unplug USB immediately.

Components:

NBL-S-TMC-7 7-in-1 Soil Composite Sensor
RS485 to TTL Module (MAX485)
DHT22
Rain Sensor Module
YF-S201 Flow Sensor
12V DC Submersible Mini Water Pump
12V Solenoid Valve
Relay Module
Buck Converter
12V DC Power Supply
Warnings
If the board resets in a loop, recheck GND and 3.3V/5V levels