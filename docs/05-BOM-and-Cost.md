# 05 · Bill of Materials & Cost

> The procurement list, **completed and corrected** — the original PDF listed sensors only (no pump/valves/dosing/power/radio) and left all prices blank. Reorganized into **kits** so you can price one farm and scale by zones.
> Related: [IoT & Firmware](./02-IoT-Hardware-and-Firmware.md) · [Field Ops](./06-Field-Deployment-and-Ops.md)

> ⚠️ **All prices are rough estimates** for planning only (≈ USD, with NPR at ~135/USD). Verify against live local suppliers (Daraz, local electronics shops, AliExpress, Robu/Robocraze imports) before purchasing. Industrial sensors and pumps vary widely by spec.

---

## What was missing from the original BOM (now added)
| Gap | Added |
|---|---|
| No water-delivery actuator | Main pump + **per-zone latching solenoid valves** |
| No fertigation hardware | **Peristaltic dosing pumps** (nutrient A/B + pH-down) |
| No actuator drivers | MOSFET/relay channels + **flyback diodes** |
| No flow feedback | Optional **YF-S201 flow meter** |
| No zone radio | **LoRa modules** (node + gateway) |
| No power system | Mains adapters **and** a solar+LiFePO4 option |
| No timekeeping/uptime hardware | **DS3231 RTC** + UPS/supercap + watchdog |
| No per-zone scaling concept | Split into reusable **zone node kits** |

> **Cost optimization to check:** many "industrial RS485 NPK" units are **7-in-1** (N, P, K, **pH, EC, temperature, moisture**) on one probe. If so, one such probe per zone can replace the separate capacitive-moisture, soil-temp, and even pH sensors — **lower cost and fewer parts**. Confirm the exact model at procurement. Also note the original "liquid pH" module is designed for **solution/water**, not direct soil; for soil pH use a 7-in-1 probe or a dedicated soil-pH method (slurry sampling) — see `06 §3`.

---

## Kit A — Gateway "brain" (one per farm) · **ESP32 (primary)**

| # | Item | Qty | Est. USD | Est. NPR |
|---|---|---|---|---|
| A1 | **ESP32 dev board** (gateway brain) | 1 | 8 | 1,100 |
| A2 | microSD card + SPI card module (telemetry buffer) | 1 | 8 | 1,100 |
| A3 | DS3231 RTC module | 1 | 3 | 400 |
| A4 | LoRa module (RFM95/SX1276) — gateway side | 1 | 10 | 1,350 |
| A5 | 5 V supply / 12 V→5 V buck + smoothing cap | 1 | 6 | 800 |
| A6 | IP65 enclosure (vented) + desiccant | 1 | 15 | 2,000 |
| A7 | 4G/LTE modem (SIM7600, UART) — **optional**, remote sites | 1 | 45 | 6,100 |
| | **Subtotal (WiFi only / +4G)** | | **~50 / ~95** | **~6,750 / ~12,850** |

### Kit A-opt — Raspberry Pi gateway upgrade (*optional*)
Swap in only for farms needing heavy edge processing, local analytics/ML, an on-site touchscreen/kiosk, a camera, or very many zones (`02 §1`). Keeps the LoRa/RTC/enclosure from Kit A; replaces the ESP32 brain.

| # | Item | Qty | Est. USD | Est. NPR |
|---|---|---|---|---|
| AO1 | Raspberry Pi 4 (8GB) | 1 | 75 | 10,100 |
| AO2 | Official RPi 4 USB-C charger (5V/3A) | 1 | 8 | 1,100 |
| AO3 | microSD 64GB high-endurance | 1 | 12 | 1,600 |
| AO4 | UPS / supercap clean-shutdown module | 1 | 20 | 2,700 |
| AO5 | Tall heatsink (+ optional fan) | 1 | 8 | 1,100 |
| AO6 | Arduino Uno R3 co-processor — *optional* | 1 | 10 | 1,350 |
| | **Added cost vs ESP32 brain** | | **~+115** | **~+15,500** |

## Kit B — Zone node (one per zone)

| # | Item | Qty | Est. USD | Est. NPR |
|---|---|---|---|---|
| B1 | ESP32 dev board | 1 | 8 | 1,100 |
| B2 | LoRa module (RFM95) | 1 | 10 | 1,350 |
| B3 | Capacitive soil moisture v1.2 | 1 | 3 | 400 |
| B4 | RS485 NPK sensor (3-in-1 or 7-in-1*) | 1 | 40 | 5,400 |
| B5 | MAX485 TTL↔RS485 module | 1 | 2 | 300 |
| B6 | pH sensor (BNC probe + amp)* | 1 | 30 | 4,000 |
| B7 | ADS1115 16-bit I2C ADC | 1 | 5 | 700 |
| B8 | DS18B20 waterproof soil-temp* | 1 | 4 | 550 |
| B9 | 12V latching solenoid valve (drip-rated) | 1 | 15 | 2,000 |
| B10 | MOSFET (IRLZ44N) + flyback diode + driver bits | 1 | 3 | 400 |
| B11 | Small IP65 enclosure | 1 | 8 | 1,100 |
| | **Subtotal per zone** | | **128** | **17,300** |

\* If using a **7-in-1 NPK** probe, B6/B8 (and B3) may be covered by it — drop ~$37/zone.

## Kit C — Shared farm hardware (weather + central actuation, one per farm)

| # | Item | Qty | Est. USD | Est. NPR |
|---|---|---|---|---|
| C1 | DHT22 air temp/humidity | 1 | 5 | 700 |
| C2 | BMP280 barometric pressure | 1 | 3 | 400 |
| C3 | Tipping-bucket rain sensor | 1 | 25 | 3,400 |
| C4 | Main water pump (12V diaphragm; size to farm)** | 1 | 25 | 3,400 |
| C5 | Peristaltic dosing pumps (nutrient A/B + pH-down) | 2–3 | 24–36 | 3,200–4,900 |
| C6 | YF-S201 flow meter (optional) | 1 | 5 | 700 |
| C7 | 4-channel relay board (pump/dosing switching) | 1 | 5 | 700 |
| C8 | Manifold + drip lines + tubing + fittings + filter/screen | kit | 45 | 6,100 |
| C9 | Hookup wire, terminal blocks, fuses, hardware | kit | 15 | 2,000 |
| | **Subtotal** | | **~152–164** | **~20,600–22,200** |

\** Larger plots may need a higher-flow AC pump driven via a contactor (extra cost; size at the pilot — `06 §5`).

## Kit D — Power (choose one)

| Option | Items | Est. USD | Est. NPR |
|---|---|---|---|
| **D-mains** (MVP default) | 12V/5A adapter + 12V→5V buck | 13 | 1,750 |
| **D-solar — ESP32 brain** | 20–30W panel + 30–50Wh LiFePO4 + PWM/MPPT | 90 | 12,200 |
| **D-solar — RPi option** | 50–100W panel + 100Wh LiFePO4 + MPPT | 195 | 26,300 |

> The ESP32 brain sips power, so its solar kit is far smaller/cheaper than the Pi's. The **pump** is the heavy, farm-specific load — size its supply separately (`02 §7`, `06 §5`).

---

## Example: one pilot farm, 3 zones

| Component | Config | USD | NPR |
|---|---|---|---|
| Gateway (Kit A) | **ESP32**, WiFi only | 50 | 6,750 |
| Zone nodes (Kit B ×3) | 3 zones | 384 | 51,900 |
| Shared (Kit C) | weather + pump + 2 dosing + flow | 157 | 21,200 |
| Power (Kit D-mains) | mains | 13 | 1,750 |
| **TOTAL (ESP32, mains, WiFi)** | | **≈ $604** | **≈ NPR 81,600** |
| + 4G modem | optional | +45 | +6,100 |
| + Solar (ESP32 brain) instead of mains | off-grid | +77 | +10,400 |
| + RPi gateway upgrade (Kit A-opt) | optional | +115 | +15,500 |
| **Each additional zone** | Kit B | +128 | +17,300 |

> Using a 7-in-1 NPK probe per zone (dropping separate pH/soil-temp/moisture) could cut roughly **$30–37/zone**, lowering a 3-zone farm by ~$90–110.

---

## Sourcing notes (Nepal-first)
- **Local/import:** Daraz NP and Kathmandu electronics shops carry ESP32, DHT22, relays, moisture sensors, buck converters cheaply — the ESP32 brain is cheap and widely stocked. The **optional** RPi 4 fluctuates in availability — buy early and expect a premium over global price if you need it.
- **Industrial NPK / RS485 / pH probes / tipping-bucket:** usually imported (AliExpress / Indian suppliers like Robu/Robocraze). Lead times 2–4 weeks — order in Phase 0.
- **Pumps, solenoid valves, drip kit:** agricultural/irrigation suppliers locally; confirm 12V vs AC and thread/fitting sizes against your tubing.
- **Solar + LiFePO4:** local solar vendors; insist on genuine LiFePO4 (not lead-acid) for cycle life/temperature.
- Buy **1–2 spares** of cheap, failure-prone parts (moisture sensors, MAX485, DHT22) per farm.

## Cost-reduction levers
- 7-in-1 probe consolidation (above).
- **ESP32 gateway brain** instead of a Raspberry Pi (saves ~$115/farm) — the default; reserve the Pi for farms that truly need it.
- Skip the Arduino — the ESP32 reads all sensors directly, so the original BOM's Arduino Uno is no longer required.
- Start with **mains** power (defer solar to Phase 2 / off-grid sites).
- WiFi instead of 4G where a router reaches the field.
- Fewer zones initially; the architecture scales by adding Kit B later.

> Keep this file updated with **actual** quoted prices as procurement proceeds; it doubles as the purchasing checklist for `06-Field-Deployment-and-Ops.md`.
