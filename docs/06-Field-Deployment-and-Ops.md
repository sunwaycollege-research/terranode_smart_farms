# 06 · Field Deployment & Operations

> The practical guide to putting TERANODE in the ground and keeping it running: site survey, install & plumbing, calibration, provisioning, commissioning, maintenance, and troubleshooting.
> Related: [IoT & Firmware](./02-IoT-Hardware-and-Firmware.md) · [Web/App provisioning](./03-Web-and-Mobile-App.md) · [BOM](./05-BOM-and-Cost.md)

---

## 1. Site survey & zone planning (do this first)
- **Map the farm** and divide it into **zones** by what actually differs: soil type/texture, slope/drainage, sun exposure, crop, and existing irrigation lines. Soil varies even within one field — that's the whole reason for zoning.
- For each zone, pick a **representative spot** for the sensors (typical soil, in the root zone, not a puddle or high spot).
- Locate the **water source** (tank/well/municipal), required pressure, and where the **manifold + valves** will sit.
- Decide **gateway location**: sheltered, powered (mains or sun for solar), within radio reach of all zones, and with WiFi or cellular signal. Check signal on a phone.
- **LoRa range check:** walk the farm with two LoRa test nodes (or a node + gateway) and confirm reliable packets from the **farthest zone**, including through crops/structures. If marginal: raise/relocate the antenna, or fall back to WiFi (close zones) or wired RS485 (`02 §4`).
- Record everything (zone list, distances, source, signal) — it feeds the Farm Designer (`03 §2.2`).

---

## 2. Physical installation

### 2.1 Gateway
- Mount the IP65 enclosure on a post/wall, **out of direct sun**, slight downward cable entries (drip loops) so water can't track in.
- Ensure the **vent + desiccant** are in place; the ESP32 brain runs cool, so add a tall heatsink only if the farm uses the optional RPi gateway (`02 §8`).
- Antenna(s) for LoRa (and 4G) mounted high/clear of metal.

### 2.2 Zone nodes
- Bury the **capacitive moisture** probe vertically in the root zone at the representative spot; backfill firmly (no air gaps).
- Insert the **NPK** probe per its datasheet depth; keep the **pH** probe wet (it must not dry out).
- Place **DS18B20** at root depth near the moisture probe.
- Mount the node enclosure above ground, sealed, with drip loops.

### 2.3 Weather mast (farm-level)
- DHT22 + BMP280 in a **radiation shield** (shaded, ventilated) ~1.5–2 m up.
- Tipping-bucket rain gauge level, open to sky, away from overhang/spray.

### 2.4 Plumbing (water + fertigation)
```
Source (tank/well) → filter/screen → [MAIN PUMP] → [dosing injection tee] → manifold
   → [zone valve 1] → drip line zone 1
   → [zone valve 2] → drip line zone 2
   → ...
Dosing pumps (A/B/pH) feed the injection tee; flow meter just after the pump (optional).
```
- Use a **screen/filter** upstream to protect valves/drippers.
- Keep fertilizer stock tanks shaded and labeled; route dosing tubing to the injection point.
- Pressure-test the line **before** energizing electronics.

### 2.5 Electrical
- Common ground between the ESP32 gateway, drivers, and 12V supply.
- Every valve/pump coil gets its **flyback diode**; fuse the 12V supply.
- Keep 12V/pump wiring physically separated from sensor signal wiring to reduce noise; use twisted pair + 120Ω termination on long RS485 runs.

---

## 3. Calibration (before commissioning)
| Sensor | Procedure | Store |
|---|---|---|
| **Capacitive moisture** | Read raw value **in air** (dry) and **fully submerged in water** (wet); map to 0–100% | air/water raw values |
| **pH** | 2-point with **pH 4.0 & 7.0** buffers; rinse between; let reading settle | slope + offset |
| **NPK (RS485)** | Confirm register map; cross-check against a **lab soil test** of the same sample; set offset/scale | register map + offsets |
| **Soil temp (DS18B20)** | Sanity-check against a known thermometer | (factory) |
| **Rain gauge** | Pour a measured volume; confirm **mm/tip** matches datasheet | mm/tip |
| **Flow meter** | Run a known volume; confirm **pulses/L** | pulses/L |
> For **soil pH**, the liquid pH probe needs soil-water **slurry** contact (or use a 7-in-1 soil probe). Document which method this farm uses (`05` cost note).

Calibration values are saved per device and synced from the cloud (`02 §10`).

---

## 4. Device provisioning & binding (matches `03 §7`)
1. Super-admin creates the **Organization + org-admin** in the master dashboard.
2. Super-admin **registers the gateway by serial** → system issues a **device token + MQTT ACL**.
3. Field tech writes that token + farm/zone radio addresses into the gateway config; flashes zone-node firmware with their **zone IDs/radio addresses**.
4. Power on; confirm the gateway connects to the broker (master dashboard shows it **online** via LWT).
5. Customer logs in, opens **Farm Designer**, defines zones, and binds each zone's node + valve.
6. Verify each zone's telemetry appears and matches the physical layout.

---

## 5. Commissioning checklist
- [ ] All sensors report plausible values in the customer dashboard.
- [ ] Each zone valve **opens and closes** on command; **fail-closed** verified (cut power → valve closes).
- [ ] Main pump starts/stops; **dry-run protection** OK; pressure reached.
- [ ] **Dosing interlock:** dosing pumps run **only** while main pump runs; metered dose looks right; per-event cap enforced.
- [ ] **Flow check** (if meter present): valve open → flow detected; valve closed → no flow.
- [ ] **Rain-skip:** simulate rain ≥ threshold → irrigation suppressed.
- [ ] **Schedule windows** respected.
- [ ] **Offline test:** disconnect internet → control keeps running; reconnect → buffered data back-fills.
- [ ] **Watchdog:** force a hang (test build) → auto-reboot; valves safe across reboot.
- [ ] Alerts fire and notify (pull a sensor, take gateway offline).
- [ ] Power: supply holds through pump inrush; ESP32 recovers cleanly after a brownout (or solar holds overnight + recharges). If using the optional RPi, verify its UPS clean-shutdown.
- [ ] Set per-zone thresholds/dosing targets with the customer; hand over login + app.

---

## 6. Maintenance schedule
| Interval | Task |
|---|---|
| Weekly (auto) | Valve-exercise pulse to prevent sticking; battery/link/health check |
| Monthly | Inspect/replace **desiccant**; clean the line **filter/screen**; check drippers; refill fertilizer stock |
| Monthly–quarterly | Re-check **pH** calibration (probes drift); verify moisture mapping after soil settling |
| Quarterly | Inspect connectors for corrosion (dielectric grease); tighten terminals; check enclosure seals/drip loops |
| Seasonal | Re-zone/re-calibrate for new crop; clean rain gauge; solar panel cleaning |
| As needed | Replace consumable probes (pH, moisture); firmware OTA updates |

---

## 7. Troubleshooting
| Symptom | Likely cause | Action |
|---|---|---|
| Gateway shows **offline** | WiFi/4G down, power, broker | Check link/power; gateway should still water locally; data back-fills on reconnect |
| **Zone missing** telemetry | LoRa out of range/interference, node battery, sensor wiring | Check node battery/signal; reposition antenna; inspect wiring |
| Moisture stuck at 0/100% | Sensor in air gap / shorted / miscalibrated | Reseat probe; recalibrate air/water |
| pH reading wild | Probe dried out / decalibrated / loose BNC | Rehydrate, recalibrate, reseat connector |
| **Valve open but no flow** | Pump off, clogged filter, kinked line, valve fault | Auto-alert closes valve; clear blockage; test valve manually |
| Over/under-watering | Wrong thresholds, bad moisture cal, schedule | Tune low/high thresholds; recalibrate; check schedule/rain-skip |
| Dosing off-target | Dosing cal, EC/pH probe, stock empty | Recalibrate dose volume; check EC/pH probe; refill stock |
| Random reboots | Brownout / unstable supply (esp. pump inrush) | Check supply + smoothing cap/UPS; ESP32 restarts instantly and keeps control. (RPi option: also check heat/ventilation + read-mostly root) |
| SD buffer errors | Card wear / loose module | Replace card; reseat SPI module. ESP32 uses the SD only as a buffer, so control keeps running |
| Condensation inside box | Desiccant spent, seal/vent issue | Replace desiccant; check vent + drip loops; conformal-coat boards |

---

## 8. Remote diagnostics & support
- Master dashboard shows fleet health (online/offline, battery, fw version, open alerts) and a scoped **"view as customer"** for debugging (`03 §2.1`, audited).
- Gateway publishes `telemetry/gateway/health` (CPU temp, link type/quality, battery, buffer depth).
- **OTA** updates from the dashboard with staged rollout + rollback (`02 §6.4`).
- Keep a per-farm **spares kit** (moisture sensor, MAX485, DHT22, fuses, desiccant) to cut return visits.

## 9. Handover to the customer
Give the customer: login + app install, a one-page "what the gauges mean," how to set thresholds and read alerts, who to contact, and the maintenance calendar above. Record the as-built (zones, calibration, pump/valve map) in the master dashboard for support.
