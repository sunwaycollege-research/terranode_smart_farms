# TERANODE — Overnight Autonomous Build (2026‑06‑06)

What I did while you slept: grounded the whole product in your **real hardware**,
ran a **deep‑research** pass, built the **IoT firmware**, aligned the **backend**,
and **buffed the farmer app + admin panel** — all kept green (typecheck/tests/
bundle). Everything below is verified unless explicitly noted.

---

## 1. Hardware reconciliation (BOM ⇄ real prototype)
Your `TerraNode/` files (pins.csv, assembly.md, schematik_esp32.ino, Wokwi)
show the **real** rig differs from the printed BOM — I built to the real rig:

- **ESP32 DevKit** is the brain (not the BOM's RPi4/Arduino/ESP8266).
- One **NBL‑S‑TMC‑7 7‑in‑1 RS485 soil probe** replaces the separate NPK + pH +
  moisture + ADS1115 + DS18B20 (it gives moisture, soil‑temp, EC, pH, N, P, K).
- **DHT22** (air temp/humidity), **rain sensor**, **YF‑S201 flow meter** (not in
  the BOM but in the wiring), **relay → 12 V pump + solenoid valve**.

## 2. Deep research → `docs/RESEARCH.md` (cited)
A fan‑out, adversarially‑verified pass (26 sources → 20 confirmed claims). It
**caught a real bug**: the soil probe's Modbus order is **Temp@0x00, Moisture@0x01**
and **pH = raw/100** — your prototype (and my first firmware draft) had Temp/
Moisture swapped and pH at /10. **Fixed in both** `TerraNode/schematik_esp32.ino`
and the new firmware. Other key findings applied:
- NPK/pH from the cheap probe are **EC‑derived estimates** ("use with caution",
  moisture‑dependent) → the app now labels N/P/K **approximate** and anchors
  fertiliser advice on the crop‑stage schedule, not raw probe NPK.
- YF‑S201: **K=7.5, 450 pulses/L** (the "22.3 mL/pulse" figure was refuted).
- Rain‑skip **≈3 mm** (smaller saves more water; never >6.4 mm) → firmware default.
- TNAU/JICA/NAST fertiliser doses by stage; Nepal drip benchmark **+20 % yield,
  −30 % water**. Gaps (no verified FAO‑56 Kc table; no low‑literacy‑UX evidence)
  are logged as the next research pass in `RESEARCH.md`.

## 3. IoT firmware → `firmware/teranode_gateway/`
A **connected** gateway sketch (the prototype was local‑only). Same sensors +:
WiFi (NVS / SoftAP), **`POST /provision` phone‑home** (device‑id‑first), **MQTT**
publish on `teranode/dev/<serial>/…` matching the ingest worker, retained config
push (cloud rule), manual valve override, the **edge control loop** (rain‑skip →
window → moisture hysteresis → max‑run), and **leak detection** (valve‑open‑no‑flow
→ alert + fail‑safe stop). README + libraries.txt included. *(Can't compile ESP32
here — written to the manual + matched to the ingest contract.)*

## 4. Backend aligned to the real sensors
- New **`flow`** telemetry channel (YF‑S201) wired end‑to‑end: DB enum + migration
  + provisioning (farm channel) + ingest map + virtual gateway. **Verified e2e** —
  flow telemetry rows persist (0 when valve closed, ~10–12 L/min when irrigating).
- New customer endpoints: **`GET /farms/:id/gateway`** (real device serial/status)
  and **`GET /farms/:id/readings`** (newest value per channel — powers the live
  sensor cards). EC handled as µS/cm → mS/cm.

## 5. Farmer app (mobile) — new features, dead‑simple + bilingual (EN/NE)
- **Water & leak card** (dashboard): live flow L/min, a red "pump on but no water
  — check pump/pipe" leak warning, and a rain‑paused note.
- **Soil nutrients card** (zone): N/P/K + pH/EC with LOW/OK/HIGH chips, one plain
  hint each, and the "N·P·K are approximate" caveat from the research.
- **Fertilizer plan card** (zone): the research‑backed, **stage‑aware** dose +
  an **organic option**, with source + "confirm with local extension".
- **Add‑a‑device onboarding**: a 3‑step WiFi/SoftAP flow that polls until the new
  box auto‑links, then "✓ connected".

## 6. Agronomy engine → fertilizer module
`fertilizerPlan(cropId, stage)` + `fertilizerSchedule(cropId)` with TNAU/JICA/NAST
doses for tomato, potato, onion, garlic, chili, cauliflower + a generic fallback;
bilingual, cited. **77 agronomy tests pass** (+5 new).

## 7. Admin web buffs ✅
- **Fleet‑health view**: status badges (online/offline/claimed/in‑stock),
  relative last‑seen, firmware, bound customer + farm, **clickable count tiles**
  and a **status filter** — all existing actions (register/claim/bind/OTA) intact.
- **Crop‑library**: a new **"Fertilizer schedule" tab** in the crop drawer that
  renders the research‑backed per‑stage doses + organic options + source tags
  (imported straight from `@teranode/agronomy`), with the regional‑reference note.

## Final verification — all green ✅
`types · agronomy · api · ingest · web · mobile` typecheck **PASS** · agronomy
**77/77 tests** · **web build PASS** · **mobile Metro bundle PASS** · `flow`
channel **e2e verified** (telemetry rows persist).

---

## How to run
```bash
cd infra && docker compose --env-file ../.env up -d --wait   # timescale, redis, mosquitto (+mailpit)
npm run -w @teranode/api migrate && npm run -w @teranode/api seed
npm run -w @teranode/api dev        # API  :4000
npm run -w @teranode/ingest start   # MQTT ingest worker
npm run -w @teranode/ingest virtual # hardware-free virtual gateway (now emits flow)
npm run -w @teranode/web dev        # admin panel
npm run -w @teranode/mobile start   # Expo (set app.json extra.apiBaseUrl to your LAN IP for a device)
```
Firmware: `firmware/teranode_gateway/` — set identity/WiFi in the header, flash an
ESP32 (Arduino IDE / PlatformIO), libraries in `libraries.txt`.

## Honest caveats
- **Firmware can't be compiled/flashed here** — written to the manufacturer manual
  + the ingest MQTT contract; bench‑test on real hardware before field use. YF‑S201
  K and the tipping‑bucket mm/tip need per‑unit field calibration.
- The **cheap probe's NPK/pH are coarse** — treated as trend only (by design).
- Fertiliser doses are **regional references** (Tamil Nadu/Nepal), not prescriptions.
- **FAO‑56 Kc tables** and **low‑literacy UX evidence** weren't verified this pass
  (logged as the next research pass).

## Suggested next steps
1. Bench‑flash the firmware on the real ESP32 + 7‑in‑1 probe; calibrate flow/rain.
2. Second research pass: FAO‑56 Kc by crop + by‑stage moisture bands + Nepal UX.
3. Surface the fertilizer schedule on the web crop library to farmers via a printable plan.
