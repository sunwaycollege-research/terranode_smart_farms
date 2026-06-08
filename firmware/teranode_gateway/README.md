# TERANODE — Connected Gateway Firmware (ESP32)

The field "brain". Reads the real BOM sensors, runs the irrigation control loop
**locally** (so the farm keeps watering through internet/cloud outages), and syncs
to the TERANODE cloud over MQTT using the **device‑id‑first** model: the device
knows only its own `{ serial, secret }` and phones home to discover which
customer/farm it belongs to.

## Hardware (see `../../TerraNode/pins.csv` + `assembly.md`)

| Component | Interface | ESP32 pins |
|---|---|---|
| NBL‑S‑TMC‑7 7‑in‑1 soil sensor (moisture, soilTemp, EC, pH, N, P, K) | RS485/Modbus via MAX485 | Serial2 RX `GPIO16`, TX `GPIO17`, DE/RE `GPIO14` |
| DHT22 (air temp + humidity) | 1‑wire digital | `GPIO18` |
| Rain sensor (LM393) | digital D0 / analog A0 | `GPIO19` / `GPIO25` |
| YF‑S201 flow meter (~7.5 Hz per L/min) | pulse (interrupt) | `GPIO21` |
| Relay → 12V pump + solenoid valve | digital (active‑LOW) | `GPIO22` |

**Soil Modbus map** (holding registers `0x0000..0x0006`): moisture (`÷10` %),
soil temp (`÷10` °C), EC (µS/cm — firmware converts to **mS/cm** `÷1000`), pH
(`÷10`), N, P, K (mg/kg).

## Device lifecycle

```
boot → WiFi (NVS creds / SoftAP portal) → POST {API_BASE}/provision {serial,secret,capabilities}
  ├─ 202 {status:'pending'}  → device unsold/unlinked, retry every 30s
  └─ 200 {status:'linked', mqttUrl, topicPrefix} → MQTT connect
        → publish telemetry/zone/1 + telemetry/weather + telemetry/gateway/health
        → subscribe cmd/gateway/config (rule push) + cmd/zone/1/valve (manual override)
        → edge control loop drives the relay + leak detection
```

## MQTT topics (match `apps/ingest`)

`{prefix}` = `teranode/dev/<SERIAL>` (returned by `/provision`).

| Topic | Direction | Payload |
|---|---|---|
| `{prefix}/telemetry/zone/1` | pub | `{moisture, soilTemp, ec, ph, n, p, k, valve, pump, mode}` |
| `{prefix}/telemetry/weather` | pub | `{airTemp, humidity, rain, rainIntensity, flow}` |
| `{prefix}/telemetry/gateway/health` | pub (retained) | `{status, fwVersion, rssi, uptimeS}` |
| `{prefix}/state/zone/1` | pub (retained) | `{valve, pump}` reported state |
| `{prefix}/cmd/gateway/config` | sub (retained) | `{moistureLow, moistureHigh, rainSkipMm, windowStart, windowEnd, maxRunMin}` |
| `{prefix}/cmd/zone/1/valve` | sub | `{open: bool, ttlSec?}` manual override |

## Edge control loop

Runs every 10 s **regardless of connectivity**:
`rain‑skip → irrigation window → moisture hysteresis (low/high) → max‑run safety →
leak detection`. The cloud pushes the per‑zone rule via the retained
`cmd/gateway/config`; offline, the firmware falls back to its compiled defaults.

**Leak detection:** if the valve is commanded OPEN but the flow meter reads
≈0 L/min for `LEAK_GRACE_CYCLES` cycles, the firmware publishes a `valve_no_flow`
critical alert and **fail‑safe stops** the dry‑running pump.

## Configuration

Identity + WiFi live in NVS (`Preferences`, namespace `teranode`) so they survive
reflash; compile‑time defaults let you flash a dev unit directly. Set in the sketch
header: `DEVICE_SERIAL_DEFAULT`, `DEVICE_SECRET_DEFAULT`, `API_BASE_DEFAULT`,
`WIFI_SSID_DEFAULT`, `WIFI_PASS_DEFAULT`.

**Production WiFi onboarding:** ship with no WiFi creds → the firmware starts a
SoftAP captive portal (or BLE) so the farmer enters their WiFi from the app once;
creds persist to NVS. (The portal is stubbed in this reference sketch — see
`connectWifi()` — wire it to `WiFiManager`/BLE for production.)

## Build

- **Arduino IDE / arduino‑cli:** board = *ESP32 Dev Module*. Install the libraries
  in `libraries.txt`, then compile/upload `teranode_gateway.ino`.
- **PlatformIO:** `platformio.ini` with `board = esp32dev`, `lib_deps` = the list
  in `libraries.txt`.
- **Wokwi (simulation):** the soil sensor + RS485 are simulated; for full
  hardware‑free testing of the *cloud* path use the **virtual gateway**
  (`apps/ingest` virtual mode), which exercises the same `/provision` + MQTT flow.
