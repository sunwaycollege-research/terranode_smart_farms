# Firmware (ESP32 Gateway)

The field "brain". A solar/12 V‑powered **ESP32 DevKit** reads the field sensors, runs the
irrigation control loop **locally**, and syncs to the cloud over MQTT using the device‑id‑first
model ({doc}`../architecture/device-lifecycle`).

Source: `firmware/teranode_gateway/teranode_gateway.ino` (connected gateway),
`firmware/sketch.ino` (base template), `TerraNode/schematik_esp32.ino` (standalone device demo).
Per‑function reference: {doc}`../reference/firmware-api`.

## 1. Bill of materials (real prototype)

```{list-table}
:header-rows: 1
:widths: 32 18 50

* - Component
  - Interface
  - Role
* - **NBL‑S‑TMC‑7** 7‑in‑1 soil probe
  - RS485 / Modbus (via MAX485)
  - moisture, soil temp, EC, pH, N, P, K — one probe, one Modbus read
* - **DHT22**
  - 1‑wire digital
  - air temperature + humidity
* - **Rain sensor** (LM393)
  - digital D0 + analog A0
  - rain present / intensity → rain‑skip
* - **YF‑S201** flow meter
  - pulse (interrupt)
  - water flow L/min → usage + leak detection
* - **Relay module** → 12 V pump + solenoid valve
  - digital (active‑LOW)
  - irrigation actuation
* - **MAX485**, buck converter, 12 V supply, IP65 enclosure
  - —
  - RS485 transceiver + power + weatherproofing
```

:::{note}
The printed BOM also lists an RPi4 + Arduino + ESP8266 variant, but the **real built prototype
(pins.csv + Wokwi) is ESP32‑based** with the 7‑in‑1 probe consolidating the separate NPK/pH/
moisture sensors. The docs describe the as‑built rig.
:::

## 2. Pin map

```{list-table}
:header-rows: 1
:widths: 40 26 34

* - Signal
  - ESP32 pin
  - Notes
* - MAX485 RX (RO) / TX (DI)
  - `GPIO16` / `GPIO17`
  - Serial2 to the soil probe
* - MAX485 DE/RE (direction)
  - `GPIO14`
  - HIGH = transmit, LOW = receive
* - DHT22 data
  - `GPIO18`
  - air temp/humidity
* - Rain D0 / A0
  - `GPIO19` / `GPIO25`
  - digital present / analog intensity
* - YF‑S201 flow signal
  - `GPIO21`
  - pulse counting via ISR
* - Relay IN
  - `GPIO22`
  - drives pump + valve (active‑LOW)
```

(Authoritative pinout: `TerraNode/pins.csv`; wiring steps: `TerraNode/assembly.md`.)

## 3. Soil probe Modbus map (verified)

Read all 7 values in a single Modbus **function 0x03** (holding registers) request, start `0x0000`,
count `0x0007` (→ 14 data bytes, 7 × 16‑bit big‑endian). **Order and scaling matter** (this
corrected a real bug where Temp/Moisture were swapped and pH used /10):

```{list-table}
:header-rows: 1
:widths: 12 22 22 44

* - Reg
  - Field
  - Scaling
  - Unit
* - 0x00
  - Temperature
  - raw / 10
  - °C
* - 0x01
  - Moisture
  - raw / 10
  - %
* - 0x02
  - EC
  - raw × 1
  - **µS/cm** (÷1000 → mS/cm for agronomy)
* - 0x03
  - pH
  - raw / 100
  - pH
* - 0x04–0x06
  - N, P, K
  - raw × 1
  - mg/kg (EC‑derived estimate — coarse)
```

:::{warning}
N/P/K and pH from low‑cost probes are **coarse, moisture‑dependent estimates** ("use with caution"
per the manufacturer). The app labels them *approximate* and anchors fertiliser advice on the
crop‑stage schedule in `@teranode/agronomy`, not raw probe NPK. See `RESEARCH.md`.
:::

## 4. Edge control loop

Runs every ~10 s **regardless of connectivity**:

```{mermaid}
flowchart TD
  A["read soil + air + rain + flow"] --> B{raining ≥ rainSkipMm?}
  B -- yes --> OFF["valve OFF (rain-skip)"]
  B -- no --> C{outside irrigation window?}
  C -- yes --> OFF
  C -- no --> D{moisture < low?}
  D -- yes --> ON["valve ON"]
  D -- no --> E{moisture > high?}
  E -- yes --> OFF
  E -- no --> HOLD["hold (hysteresis)"]
  ON --> F{max-run exceeded?}
  F -- yes --> OFF
  ON --> G{valve open & flow ≈ 0?}
  G -- yes --> LEAK["leak/dry alert + fail-safe stop"]
```

- **Hysteresis** — open below `moistureLow`, close above `moistureHigh`; hold between (no chatter).
- **Rain‑skip** — skip when recent rainfall ≥ threshold (~3 mm default; smaller saves more water).
- **Window + max‑run** — only irrigate inside the allowed hours, with a safety cap on run length.
- **Leak detection** — valve commanded open but the YF‑S201 reads ≈0 L/min → fault + stop. The
  flow K‑factor is ~7.5 (450 pulses/L).
- **Cloud rule push** — the cloud sends the per‑zone rule (low/high, rain‑skip, window) as a
  **retained** `cmd/gateway/config`; offline, the firmware falls back to compiled defaults.

## 5. Connectivity

```{list-table}
:header-rows: 1
:widths: 28 72

* - Stage
  - Behavior
* - WiFi
  - Credentials from NVS (`Preferences`); production starts a **SoftAP** captive portal so the farmer enters WiFi once. Creds persist across reflash.
* - Provision
  - `POST {API}/provision { serial, secret, capabilities }` → caches `{accountId, farmId, topicPrefix}`; retries while `pending` (unclaimed).
* - Telemetry
  - Publishes `{prefix}/telemetry/zone/1`, `{prefix}/telemetry/weather`, `{prefix}/telemetry/gateway/health` (retained), `{prefix}/state/zone/1` (retained). See {doc}`../reference/mqtt-topics`.
* - Commands
  - Subscribes to `{prefix}/cmd/gateway/config` (rule) + `{prefix}/cmd/zone/1/valve` (manual override).
```

## 6. Build & flash

- **Arduino IDE / arduino‑cli** — board *ESP32 Dev Module*; install the libraries in
  `firmware/teranode_gateway/libraries.txt` (ModbusMaster, DHT, PubSubClient, ArduinoJson;
  WiFi/HTTPClient/Preferences are in the ESP32 core).
- **Wokwi** — `firmware/diagram.json` simulates the wiring.
- **Hardware‑free cloud test** — use the {doc}`simulator` (virtual gateway / device‑sim) which
  exercises the exact `/provision` + MQTT contract.

The generated per‑function API reference (Doxygen → Breathe) is in {doc}`../reference/firmware-api`.
