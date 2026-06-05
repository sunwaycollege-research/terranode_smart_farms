# TERANODE — Simulations

Two ways to *see* TERANODE before any hardware exists. Both are runnable today.

## 1. 🌱 Animated digital twin — `apps/simulator/teranode-twin.html`  ⭐ start here
A single self-contained web page. **Just double-click it** (opens in any browser — Chrome/Edge/Firefox).
No install, no server, no internet.

It shows the whole field "alive":
- An **ESP32 gateway** + **3 zones** (Tomato / Capsicum / Spinach), each with soil moisture, pH, EC, N-P-K, soil temp.
- The **real control logic from [`02-IoT-Hardware-and-Firmware.md`](./02-IoT-Hardware-and-Firmware.md) §6** running live: per-zone moisture
  hysteresis, rain-skip, schedule window, pump + central fertigation dosing, and a max-run safety stop.
- Animated **valves opening**, water droplets on irrigating zones, a pulsing **pump** and **dosing**, and a weather widget (sun/cloud/rain).
- A live **moisture chart** (with low/high bands, valve-open shading, rainfall bars) and a scrolling
  **MQTT telemetry + alerts** console showing the exact payloads the cloud would receive.

**Try this:**
- Drag the **speed** slider (top right) to fast-forward the day.
- Click **🌧️ Make it rain** → watch zones get **rain-skipped** even while dry.
- Click **🏜️ Drought zone** on the selected zone → its valve opens and you see it recover.
- Click **📴 Toggle gateway** → it goes "offline" but **keeps irrigating locally** (edge-first) and buffers telemetry, then **back-fills** when you toggle it back.
- Click any zone to inspect it; switch a zone to **Manual** to override the valve yourself.

*(Verified: runs 400+ simulation steps with no errors; the irrigation logic actually actuates.)*

## 2. 🔌 Hardware-level simulation — `apps/firmware/`
The actual **ESP32 firmware** on a simulated breadboard at [wokwi.com](https://wokwi.com): real sensors
(DHT22, DS18B20, pots for moisture/pH/NPK), a rain button, valve/pump/dosing LEDs, and an I2C LCD.
Use this to see the **edge device and code** itself. See [`apps/firmware/README.md`](../apps/firmware/README.md) for the 2-minute setup.

> ⚠️ Wokwi must be an **Arduino** ESP32 project (file `sketch.ino`, compiled as C++). An ESP-IDF/C
> project (`main.c`) will fail to compile the Arduino libraries — see the Troubleshooting note in `apps/firmware/README.md`.

---

### Which one for what?
| Goal | Use |
|---|---|
| Show stakeholders/customers "what the system does" | **`apps/simulator/teranode-twin.html`** |
| Demo/validate the edge firmware & wiring | **`apps/firmware/`** |
| Both behaviors map back to | [`01-System-Architecture.md`](./01-System-Architecture.md) and [`02-IoT-Hardware-and-Firmware.md`](./02-IoT-Hardware-and-Firmware.md) |

Numbers in both are **modeled, not measured** — the point is to show behavior and UX, not exact agronomy.
