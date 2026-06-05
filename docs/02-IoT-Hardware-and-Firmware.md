# 02 · IoT — Hardware & Firmware

> The field side of TERANODE: the gateway "brain", per-zone nodes, every sensor and how it's read, the pump/valve/fertigation actuators, the radio link, power, control logic, and reliability.
> Related: [Architecture](./01-System-Architecture.md) · [BOM & Cost](./05-BOM-and-Cost.md) · [Field Ops](./06-Field-Deployment-and-Ops.md)

---

## 1. Edge topology — who computes what, and why

A farm has **one gateway** and **N zone nodes** + **one shared weather mast**.

```
                         ┌─────────────────────────────────────────┐
                         │  GATEWAY "the brain" — ESP32 (RPi opt.)  │
                         │  • aggregates all zone + weather data    │
                         │  • runs irrigation/fertigation control   │
                         │  • drives MAIN PUMP + DOSING PUMPS        │
                         │  • SD-card/flash buffer + MQTT to cloud  │
                         │  • C/C++ firmware; WiFi + LoRa + 4G(opt) │
                         └───────▲───────────▲───────────▲──────────┘
            LoRa / WiFi / RS485  │           │ wired     │ wired
                 ┌───────────────┘           │           └────────────┐
        ┌────────┴────────┐        ┌─────────┴───────┐       ┌─────────┴─────────┐
        │  ZONE NODE 1    │        │  ZONE NODE N    │       │  WEATHER MAST     │
        │  ESP32          │  ...   │  ESP32          │       │  DHT22, BMP280,   │
        │  • moisture     │        │  • moisture     │       │  tipping-bucket   │
        │  • NPK (RS485)  │        │  • NPK (RS485)  │       │  rain             │
        │  • pH (ADS1115) │        │  • pH           │       └───────────────────┘
        │  • soil temp    │        │  • soil temp    │
        │  • ZONE VALVE   │        │  • ZONE VALVE   │
        └─────────────────┘        └─────────────────┘
```

**Design rationale (why this split):**

| Unit | Owns | Why |
|---|---|---|
| **ESP32** (gateway — *primary*) | Aggregation, control logic, networking, storage, **central pump + dosing**; reads local sensors directly (ADC, I2C, 1-Wire, UART/RS485) | Cheap, low-power (great for solar), instant-on, robust — no Linux/SD-boot fragility; built-in WiFi, LoRa via SPI, 4G via UART modem; MQTT/TLS + OTA supported |
| **Raspberry Pi 4** (gateway — *optional upgrade*) | Same role, chosen when a farm needs heavy edge processing, local analytics/ML, an on-site touchscreen/kiosk, a camera, or very many zones | More CPU/RAM/storage + Linux conveniences (Python agent, local web server) — but higher power/heat and needs clean shutdown, so reserve it for farms that need it |
| **Arduino Uno** (*optional* co-processor) | Only to offload time-critical sampling or isolate noisy 12 V I/O from the brain | The ESP32 already handles Modbus/analog/1-Wire/interrupts, so this is **no longer required** by default (it was in the original BOM for analog pH parsing) |
| **ESP32 zone node** | One zone's sensors + that zone's valve, talks to gateway over radio | Cheap, low-power, WiFi+LoRa capable; one per zone keeps wiring local — same chip as the brain keeps the toolchain single |
| **ESP8266** (from original BOM) | Usable as a simple zone node where ESP32 features aren't needed | Already in the BOM; **ESP32 recommended** for both gateway and new nodes (more ADC/GPIO, dual-core) |

> **Note on the original BOM:** it describes essentially a *single* sensor kit (RPi + Arduino + one set of sensors). TERANODE now uses an **ESP32 as the gateway brain** (Raspberry Pi optional), and for the **zoned, multi-node** product each additional zone needs its own node kit, plus the **actuators (pump, valves, dosing pumps) + radio + power** — see `05-BOM-and-Cost.md`.

---

## 2. Sensor integration reference

| # | Sensor (BOM) | Measures | Protocol | Read by | Wiring / notes | Calibration |
|---|---|---|---|---|---|---|
| 1 | **Capacitive soil moisture v1.2** | Volumetric moisture | Analog 0–3 V | ESP32 ADC (or ADS1115) | Corrosion-resistant; bury in root zone | 2-point: reading in **air** (dry) and **submerged** (wet) → map 0–100 % |
| 2 | **Industrial RS485 NPK sensor** | N, P, K (often + pH/EC/temp/moisture on 7-in-1) | **Modbus RTU** over RS485 | ESP32 (UART) via **MAX485** | 9600 8N1 typical; sensor at 9–24 V, **isolated** from logic; A/B twisted pair | Verify against lab soil test; apply offset/scale per crop |
| 3 | **Liquid pH sensor (BNC + amp board)** | Soil-slurry / solution pH | Analog → I2C | **ADS1115** → ESP32 (I2C) | Amp board has offset trim + temp comp; keep probe wet | **2-point** with pH 4.0 & 7.0 buffers; store slope+offset |
| 4 | **DS18B20 (waterproof)** | Soil temperature | 1-Wire | ESP32 (1-Wire) | 4.7 kΩ pull-up; many on one bus by address | Factory-accurate; sanity-check vs ambient |
| 5 | **DHT22** | Air temp + humidity (weather mast) | 1-Wire digital | ESP32 | 2.3 kΩ pull-up; ≤0.5 Hz sample | Factory; replace if drift |
| 6 | **BMP280** | Barometric pressure + altitude | I2C | ESP32 | SDA/SCL with pull-ups; ~100 kHz | Set local sea-level pressure for altitude |
| 7 | **Tipping-bucket rain** | Rainfall | Reed switch pulse | ESP32 interrupt | Debounce; count tips | mm/tip per datasheet (e.g., 0.2 mm); field-verify with measured pour |
| 8 | **ADS1115 (16-bit I2C ADC)** | (enables analog pH/moisture on I2C) | I2C | ESP32 | 4 channels, programmable gain | n/a |
| 9 | **MAX485 module** | TTL↔RS485 transceiver | — | ESP32 | DE/RE tied for half-duplex; 120 Ω termination on long runs | n/a |

> The ESP32 reads everything above directly. An **optional Arduino co-processor or RPi gateway** can take over time-critical sampling if a deployment needs it, but it isn't required.

**Modbus RTU read (NPK), sketch of logic:**
```
set DE/RE = TX
send [addr][func 0x03][reg_hi][reg_lo][count_hi][count_lo][CRC_lo][CRC_hi]
set DE/RE = RX
read response; verify CRC16-Modbus; parse N,P,K (mg/kg) [+ pH/EC/temp/moisture if 7-in-1]
on CRC/timeout: retry up to 3×, else mark channel quality=bad
```
> Exact register map varies by vendor — confirm from the unit's datasheet at procurement and record it in the firmware config (`02 §9`).

---

## 3. Actuators & water automation  ⚠️ (the biggest gap in the original BOM)

The procurement list has **no pump, no valve, no dosing, no drivers** — yet "water automation + fertigation" is the whole point. The actuator set:

| Actuator | Role | Recommended part | Driver | Safety |
|---|---|---|---|---|
| **Main water pump** | Pressurize the line from tank/well | 12 V DC diaphragm pump (or AC pump via contactor for larger farms) | Relay or MOSFET + flyback diode | Dry-run protection; pressure/flow check |
| **Per-zone solenoid valve** | Open/close water to a zone | **12 V latching** solenoid (drip-rated) | MOSFET (IRLZ44N) + flyback diode, or relay | **Fail-closed** (spring/latched); valve-exercise weekly |
| **Dosing pump(s)** (fertigation) | Inject liquid fertilizer / pH adjuster into the line | Peristaltic dosing pumps (1–3: nutrient A/B + pH-down) | Relay/MOSFET or motor driver | Interlock: dose only while main pump runs |
| **Flow meter** (optional) | Confirm water actually flowed; volume per zone; leak detect | YF-S201 (450 pulses/L) | Interrupt counting on the ESP32 | Alert if "valve open but no flow" |

**Why latching solenoids:** they hold open/closed with only a brief pulse (~100 ms), so a valve draws essentially **zero standby power** — critical for solar/off-grid. They also fail to their last state safely.

**Fertigation flow (MVP = central injection):**
```
Tank/Well → [Main pump] → [Dosing injection point] → manifold → [Zone valve 1..N] → drip lines
                              ▲
                    [Dosing pumps A/B/pH]  (run only while main pump is ON;
                                            dose volume from EC/pH target)
```
> MVP doses **centrally** for the whole irrigation event. Per-zone recipes would require per-zone injection (a future hardware change) — see `01 §1 non-goals`.

**Control wiring summary:** drivers sit in the **IP65 gateway enclosure**; 12 V comes from the power subsystem (`§7`); each relay/MOSFET channel maps to an **ESP32 GPIO**; every inductive load (valve/pump coil) gets a **flyback diode**; the ESP32 owns both the time-critical pulsing/flow counting and the control decisions (an optional Arduino co-processor can offload sampling if needed).

---

## 4. Zone-node ↔ gateway link

**Default: LoRa (point-to-point / star).** Best for real fields where zones are spread out.

| Option | Range | When to use | Cost impact |
|---|---|---|---|
| **LoRa (RFM95 / SX1276)** *(default)* | ~1–5 km LoS | Spread fields, separate plots | + LoRa module per node + gateway concentrator |
| **WiFi / ESP-NOW** | ~100 m | Zones clustered near the gateway/router | Uses ESP8266/ESP32 already planned |
| **Wired RS485 bus** | 1 km cabled | Permanent installs, no battery/radio worries | Trenching/cabling labor |

**Recommendation:** LoRa for the pilot; survey actual distances on site (`06 §1`). Each node sends a compact frame (zone id, readings, battery, valve state) every 30–120 s and listens briefly for valve commands; the gateway is the LoRa "master." Plain LoRa P2P (not LoRaWAN) avoids a gateway subscription — LoRaWAN is a later option if a multi-site network emerges.

---

## 5. Gateway ↔ cloud connectivity

- **Primary: WiFi** (ESP32 built-in) when a router reaches the field/farmhouse — free, low power.
- **Option: 4G/LTE** via a SIM7600-class modem (ESP32 drives it over **UART/AT commands**) + data SIM, for remote sites. (On the optional RPi gateway, the same modem connects over USB/HAT.)
- **Behavior:** maintain MQTT/TLS to the broker; on link loss, **buffer to the SD card/flash** and back-fill on reconnect; exponential-backoff reconnect; report link type/quality in `telemetry/gateway/health`.
- **Data thrift (for cellular):** batch zone telemetry, send rollups not every raw sample, compress payloads; commands are tiny.

---

## 6. Control logic (firmware/agent)

Runs on the gateway, **offline-capable**, config pushed from cloud (`01 §4,6`).

### 6.1 Irrigation — per-zone moisture threshold with hysteresis
```
for each zone, every CONTROL_INTERVAL (e.g. 5–15 min):
  if zone.mode == MANUAL: honor manual state; skip auto
  if now outside allowed SCHEDULE window: ensure valve CLOSED; continue
  if rain_last_24h >= rule.rain_skip_mm: ensure valve CLOSED (rain-skip); continue
  if moisture < rule.moisture_low:  open zone valve + ensure main pump ON
  elif moisture > rule.moisture_high: close zone valve
  else: hold current state            # hysteresis band prevents rapid toggling
turn main pump OFF when no zone valve is open
```

### 6.2 Fertigation — EC/pH targeted dosing (central, MVP)
```
when an irrigation event starts and dosing enabled:
  while main pump running:
    read inline/representative EC and pH
    if EC < ec_target: pulse nutrient pump(s) a metered dose; wait mix interval
    if pH > ph_target: pulse pH-down pump a metered dose; wait mix interval
    cap total dose per event (safety); log every dose
  stop dosing when pump stops
```

### 6.3 Safety & guards
- **Max-run timeout** per valve/pump (prevents flooding if a sensor fails).
- **Flow check** (if meter present): valve open + no flow → close + alert.
- **Dosing interlock:** never dose without the main pump running.
- **Fail-closed:** on fault/power-loss valves default closed; last state stored in RTC/EEPROM.
- **Manual override** from app supersedes auto for a TTL, then reverts to auto.

### 6.4 Updates (OTA)
- ESP32 gateway firmware updates via **signed `esp_https_ota`** pulled over HTTPS, triggered from the master dashboard; staged rollout; rollback on failed health check. (The optional RPi agent updates via a signed package / `git`/`apt` channel.)
- Zone-node firmware updated over the wire where the radio allows, else via service visit (`06`).

---

## 7. Power

**Two documented paths** (decision: support both).

### 7.1 Mains (MVP default)
- ESP32 gateway on a 5 V supply (USB or a 12 V→5 V buck shared with the actuator rail).
- A 12 V DC supply for pump/valves/dosing (sized to pump inrush).
- A small cap/UPS smooths the supply through pump inrush; the ESP32 restarts instantly after a brownout (no Linux boot, no SD to corrupt).

### 7.2 Off-grid solar (documented add-on)
Rough daily budget (single ESP32 gateway, light cellular use, latching valves):

| Load | Draw | Energy/day |
|---|---|---|
| **ESP32 gateway + sensors** | ~0.3–0.8 W | ~8–18 Wh |
| 4G modem (intermittent) | 2–5 W active | ~5–10 Wh |
| Latching valves (pulse) | ~0 standby | <1 Wh |
| Dosing/pump (brief) | as used | event-based |
| **Total excl. pump (conservative)** | — | **~20–40 Wh/day** |

**Recommended kit (ESP32 brain):** ~20–30 W solar panel + **LiFePO4** 30–50 Wh battery + PWM/MPPT controller → multi-day autonomy. The ESP32 sips power, so the solar kit is far smaller than a Pi would need. LiFePO4 for safety/temperature/cycle life; mount battery in shade. The **pump** is the heavy load — run it off mains or its own larger battery and size it from its actual duty cycle at the pilot (`06 §5`).
> If a farm opts for the **RPi gateway**, budget ~**110–150 Wh/day** instead (≈50–100 W panel + 100 Wh battery) — the Pi dominates that figure.

### 7.3 Outdoor cautions
- **ESP32 brain:** runs cool and low-power with no boot/SD-corruption fragility — ideal for sealed, solar, and brownout-prone sites. Still mount out of direct sun and vent the enclosure.
- **Optional RPi gateway:** throttles ≥80 °C → **tall aluminum heatsink** + vented enclosure, out of direct sun; brownouts can corrupt SD cards → high-endurance card + clean-shutdown UPS + read-mostly root.
- **Local storage:** ESP32 buffers telemetry to an **SD card (SPI)** and keeps config in **NVS/flash**; size the SD for your offline-retention needs.

---

## 8. Reliability for unattended field operation

| Risk | Mitigation |
|---|---|
| Firmware hang | **Hardware watchdog** — ESP32 task watchdog auto-reboots (RPi `bcm2835_wdt` + `systemd` watchdog if using the Pi option) |
| Power loss mid-cycle | Fail-closed valves; last state in **DS3231 RTC** / flash; instant restart + auto-resume on power return |
| Lost internet | Offline control + SD-card/flash buffer + back-fill on reconnect |
| Condensation/corrosion | IP65 box + **vent + silica-gel desiccant**; conformal-coat PCBs; stainless fasteners; dielectric grease on terminals |
| Heat | Low-power ESP32 runs cool — vent enclosure + temp monitoring (add a heatsink only for the optional RPi) |
| Stuck valve from mineral buildup | Weekly **valve-exercise** pulse; inline debris screen |
| Sensor failure | Quality flags, plausibility bounds, max-run timeouts so a bad reading can't flood |
| Device theft/loss | Revoke device token in cloud; gateway useless without re-provisioning |

---

## 9. Firmware/agent module breakdown

**Gateway firmware (C/C++ on ESP32 — Arduino framework / ESP-IDF, built with PlatformIO):**
```
gateway/
  sensors/        # local I2C (BMP280, ADS1115), 1-Wire (DS18B20), analog (ADC)
  modbus/         # NPK RS485 polling + CRC (UART + MAX485)
  radio/          # LoRa rx from zone nodes / tx valve commands (SPI)
  control/        # irrigation + fertigation state machines, schedule, rain-skip, safety
  actuators/      # pump, zone valves, dosing — GPIO + flow feedback
  buffer/         # ring buffer on SD card (SPI) / flash; back-fill
  net/            # WiFi + optional 4G (UART AT); reconnect/backoff
  mqtt/           # TLS client, topic (de)serialization, desired-vs-reported state
  config/         # NVS/flash cache of cloud-pushed rules; calibration store
  health/         # chip temp, battery, link, fw version; watchdog kick
  ota/            # signed esp_https_ota update + rollback
```

**Zone-node firmware (C/C++ on ESP32 — same toolchain as the gateway):**
```
node/
  sensors: moisture(ADC), NPK(Modbus via MAX485), pH(ADS1115), DS18B20
  radio:   LoRa frame tx (readings, battery, valve state) / rx (valve cmd)
  valve:   latching solenoid pulse driver + fail-closed
  power:   deep-sleep between reports (battery nodes)
  wdt:     watchdog
```

> **Optional Raspberry Pi gateway:** when a farm takes the Pi upgrade, the same responsibilities run as a Linux **Python** agent (SQLite buffering + a local web/kiosk server for an on-site touchscreen). The ESP32 firmware and the Pi agent expose the **same MQTT contract**, so the cloud and apps don't change.
> **Optional Arduino co-processor:** only to offload time-critical sampling or isolate 12 V I/O — a deterministic loop streaming a compact line-protocol over UART to the brain. Not used by default.

---

## 10. Calibration & per-unit config

Each node/gateway stores a small config (synced from cloud) holding: zone id & radio address, moisture air/water raw values, pH slope+offset, NPK register map + offsets, rain mm/tip, flow pulses/L, valve channel mapping, control thresholds. Calibration procedures are in **`06 §3`**.

---

## 11. Bench → field bring-up order
1. Single node on the bench: read all sensors, print values, verify calibration.
2. Add ADS1115 + pH on the gateway; verify against buffers.
3. Wire one valve + driver; test open/close and **fail-closed**.
4. Run the irrigation state machine dry (simulate moisture) → confirm valve/pump logic.
5. Add dosing pumps; test interlock + metered dose.
6. Bring up LoRa link node↔gateway; confirm telemetry + valve command round-trip.
7. Connect gateway to cloud broker; confirm telemetry up + command down + offline buffering.
8. Mount in IP65 enclosure; 2-week field trial; tune thresholds to real soil response.
