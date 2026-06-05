# TERANODE — IoT Edge Simulation (Wokwi / ESP32)

A **runnable** simulation of the TERANODE field device — an ESP32 "brain" reading the real
sensor set and running the actual irrigation/fertigation control logic from
[`docs/02-IoT-Hardware-and-Firmware.md`](../../docs/02-IoT-Hardware-and-Firmware.md).
It runs in your browser on **[wokwi.com](https://wokwi.com)** — no hardware or install needed.

---

## ▶️ How to run it (≈2 minutes)

> ⚠️ **It must be an _Arduino_ ESP32 project** (main file `sketch.ino`, compiled as C++).
> Do **not** start an "ESP-IDF" / C project — that compiles `main.c` as C and every Arduino
> library fails (`unknown type name 'class'`). See Troubleshooting below.

1. Open the **Arduino ESP32** template directly: **https://wokwi.com/projects/new/esp32**
   (or on wokwi.com: *New Project → ESP32* and make sure it's the **Arduino** one, whose file is `sketch.ino`).
2. Open the **`diagram.json`** tab, select-all, and paste this folder's `diagram.json`.
3. Open the **`sketch.ino`** tab, select-all, and paste this folder's `sketch.ino`. **Keep the file named `sketch.ino`.**
4. Add the libraries: click the **Library Manager** (📚) and add each line from `libraries.txt`
   (`DHTesp`, `OneWire`, `DallasTemperature`, `LiquidCrystal I2C`) — or add a `libraries.txt`
   file to the project and paste it in; Wokwi auto-installs them.
5. Press the green **▶ Play** button. Open the **Serial Monitor** (bottom) to see live telemetry.

> Prefer your editor? Install the **Wokwi for VS Code** extension and use the included `wokwi.toml`.
> It still needs an Arduino/PlatformIO C++ build — point `wokwi.toml` at your compiled `.bin`/`.elf`.

---

## 🎛️ What you can do while it runs

| Control | Action | What it demonstrates |
|---|---|---|
| **Soil Moisture** pot | Drag down ↘ | Moisture drops below the **low** threshold → valve + pump turn **ON** (hysteresis) |
| **Soil Moisture** pot | Drag up ↗ | Moisture passes the **high** threshold → valve turns **OFF** |
| **pH probe** pot | Drag | pH reading changes; fertigation nudges it toward the target while dosing |
| **NPK (N)** pot | Drag | N/P/K + EC readings change (real device reads this over RS485/Modbus) |
| **RAIN TIP** button | Press a few times | Rainfall accumulates → **rain-skip** suppresses irrigation even if dry |
| **DHT22 / DS18B20** | Click the part | Change air temp/humidity & soil temp in the telemetry |
| Wait & watch the clock | — | Outside the **05:00–19:00** window the valve stays closed (schedule) |

**LEDs:** 🟢 Zone valve · 🔵 Main pump · 🟡 Fertigation dosing.
**LCD (16×2):** the on-site HMI — shows moisture/pH and valve/pump/dosing or the current reason.

---

## 🔌 What's on the board (maps to the BOM & `02`)

| Sim part | Real TERANODE component |
|---|---|
| ESP32 DevKit | The **gateway brain** (ESP32; Raspberry Pi optional) |
| Potentiometer "Soil Moisture" | Capacitive soil moisture sensor (analog) |
| Potentiometer "pH probe" | pH BNC probe + amp → ADS1115 |
| Potentiometer "NPK (N)" | Industrial RS485 NPK sensor (Modbus via MAX485) |
| DHT22 | Air temperature + humidity (weather mast) |
| DS18B20 | Soil temperature probe |
| Pushbutton "RAIN TIP" | Tipping-bucket rain gauge (each press = one tip) |
| Green / Blue / Yellow LEDs | Zone solenoid **valve** / main **pump** / **dosing** pump (via relay/MOSFET in real HW) |
| I2C LCD1602 | Optional on-site touchscreen/HMI |

---

## 🧠 The control logic it runs (live, in `sketch.ino`)

Exactly the MVP algorithm from `02 §6`:

1. **Rain-skip** — if rolling rainfall ≥ threshold, keep the valve closed.
2. **Schedule window** — only irrigate between 05:00 and 19:00 (sim time).
3. **Moisture hysteresis** — open below `low` (45%), close above `high` (70%), hold in between.
4. **Pump + central fertigation** — pump runs while any valve is open; dosing runs while pumping and nudges EC/pH toward targets.
5. **Safety max-run** — a valve open too long closes itself and raises an alert.

Every 2 seconds it prints a JSON line in the **exact shape that gets published to MQTT**:

```
teranode/acme/farm1/gw1/telemetry/zone/1  {"t":"08:14","moisture":42,"ph":6.31,"ec":1.55,
"n":118,"p":53,"k":153,"airTemp":27.0,"humidity":54,"soilTemp":21.4,"rain_mm_1h":0.0,
"valve":true,"pump":true,"dosing":true,"mode":"auto"}   | IRRIGATING (low moisture)
```

That payload is what the cloud ingest worker stores and the dashboard/app render
(see [`docs/01-System-Architecture.md`](../../docs/01-System-Architecture.md) §4 and
[`docs/03-Web-and-Mobile-App.md`](../../docs/03-Web-and-Mobile-App.md)).

---

## 🛠️ Troubleshooting

**`unknown type name 'class'`, `expected '=' … before '{'`, `fatal error: functional: No such file`, or the path says `/sketch/main.c`**
→ Your project is being compiled as **C**, not C++. This happens when you start an **ESP-IDF / C**
project (its main file is `main.c`). Arduino/ESP32 libraries are C++ and can only compile in an
**Arduino** project whose main file is **`sketch.ino`**.
**Fix:** create a fresh project from **https://wokwi.com/projects/new/esp32**, paste the code into
`sketch.ino` (don't rename it to `.c`), then re-add the libraries. The same code compiles cleanly there.

**A specific library won't install or compile**
→ Set its flag to `0` at the top of `sketch.ino` (`#define USE_DHT 0`, `USE_DS18B20 0`, or `USE_LCD 0`).
The firmware drops that sensor and uses a simulated value, so the rest still runs.

**LCD stays blank**
→ Some I2C backpacks use address `0x3F` instead of `0x27`. Change `LiquidCrystal_I2C lcd(0x27, 16, 2);`
to `0x3F`, or set `USE_LCD 0`.

## ⚠️ Notes & scope of the simulation

- This single ESP32 plays **both** roles for clarity: a zone node *and* the brain running the loop.
  In the real system, several **zone nodes** report to **one gateway** over **LoRa** (`02 §1, §4`) — Wokwi
  can't simulate the LoRa radio link, so it's represented by the local sensors here.
- The **NPK** sensor is shown as a potentiometer because Wokwi has no Modbus-RTU soil-probe model;
  the firmware comment marks where the real RS485 read goes.
- If a library fails to install/compile, set its `USE_DHT` / `USE_DS18B20` / `USE_LCD` flag to `0`
  at the top of `sketch.ino`; the firmware falls back to a simulated value and still runs.
- Outputs are LEDs (guaranteed to run). On real hardware these are relay/MOSFET channels driving
  12 V latching solenoids and pumps with flyback diodes (`02 §3`).
