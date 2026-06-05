# 04 · Roadmap & Phased Plan

> How TERANODE gets built — phases, milestones, rough timeline, what's in/out, risks, and "done" criteria.
> Related: [Architecture](./01-System-Architecture.md) · [IoT](./02-IoT-Hardware-and-Firmware.md) · [Web/App](./03-Web-and-Mobile-App.md) · [BOM](./05-BOM-and-Cost.md)

---

## Guiding principles
- **Edge-first:** a farm must keep watering correctly through cloud/internet/power outages.
- **Multi-tenant from day one** (explicit requirement) — but prove **one real farm end-to-end** inside that multi-tenant system first.
- **Build software against a virtual gateway** so the app isn't blocked on hardware.
- **De-risk the unknowns early:** the NPK Modbus map, LoRa field range, pump/dosing plumbing, and outdoor power are the riskiest items — touch them in Phase 0/1.

> Timeline assumes a small team (≈1 firmware/electronics + 1–2 full-stack + shared design). Durations are planning estimates, not commitments. Adjust to the actual team.

---

## Phase 0 — Foundations & single-zone prototype  *(≈2–3 weeks)*
**Goal:** prove the riskiest hardware + stand up the skeleton software.

Hardware/firmware
- Bench-wire **one zone**: capacitive moisture, NPK (Modbus/MAX485), pH (ADS1115), DS18B20; confirm readings + calibration (`02 §2, §10`).
- Decode the **NPK register map** from the actual unit; record it.
- Drive **one solenoid valve** + driver; verify open/close and **fail-closed** (`02 §3`).
- ESP32 gateway firmware reads sensors → prints/logs → buffers to SD card/flash.

Software/cloud
- Repo/monorepo + Docker Compose (nginx, api, mosquitto, postgres+timescale, redis) (`03 §9`).
- DB schema + migrations + seed; auth + RBAC + tenant scoping (`03 §6`).
- **Virtual gateway** publishing fake MQTT telemetry → ingest → DB → WebSocket.

**Exit / DoD:** one zone's real readings logged locally; valve toggles safely; cloud skeleton ingests virtual telemetry and a basic live view renders; CI green.

---

## Phase 1 — MVP: one real farm, multi-tenant cloud  *(≈6–10 weeks)*
**Goal:** a real pilot farm fully automated, managed through the multi-tenant product.

Hardware/firmware
- **Zone nodes** (2–4 zones) with LoRa link to the gateway; telemetry + valve command round-trip (`02 §4`).
- **Main pump + per-zone valves + dosing pumps**; central fertigation; safety guards (max-run, dosing interlock, fail-closed) (`02 §3, §6`).
- Weather mast (DHT22/BMP280/rain) on the gateway.
- **Mains power** path; IP65 enclosure with venting/desiccant; watchdog + RTC (`02 §7, §8`).
- Offline control loop + SD-card/flash buffer + back-fill verified.

Software/cloud
- **Customer admin panel:** farm designer (zones), live overview, history/charts, per-zone rules/schedules, dosing targets, actuator switches with desired-vs-reported state (`03 §2.2`).
- **Master dashboard:** create org + org-admin, register/bind gateway + issue device token, fleet health from LWT, audit log (`03 §2.1`).
- **Alerts engine** (offline, sensor fault, valve-open-no-flow, out-of-range) + email + push.
- **React Native app:** overview + controls + push (`03 §3`).
- Manual provisioning flow working end-to-end (`03 §7`).
- TLS, device ACLs, backups (`01 §7, §8`).

**Exit / DoD:** pilot farm runs unattended for **2+ weeks**; auto-irrigation + fertigation behave correctly; customer manages everything from web + app; offline test (pull internet) keeps watering and back-fills on reconnect; super-admin can provision a second org in a sandbox.

---

## Phase 2 — Hardening, scale to several farms, field robustness  *(≈6–10 weeks)*
**Goal:** dependable for multiple paying farms.

- **OTA** firmware/agent updates with staged rollout + rollback (`02 §6.4`).
- **Off-grid solar kit** option (panel + LiFePO4 + MPPT), validated on a solar site (`02 §7.2`, `05`).
- Multi-farm/org polish; richer RBAC; reports & CSV/scheduled summaries.
- **TimescaleDB** continuous aggregates + compression + retention tuned (`03 §5`).
- Postgres **RLS** hardening; staging mirrors prod; monitoring/alerting on the cloud itself (uptime, disk, broker).
- Optional **on-site touchscreen** HMI (`03 §2.3`).
- Flow-meter feedback + leak detection as standard.

**Exit / DoD:** ≥3 farms live; OTA proven on real devices; solar site stable through cloudy days; on-call runbook + monitoring in place.

---

## Phase 3 — Productize & scale  *(post-pilot)*
**Goal:** turn the pilot into a sellable, scalable product.

- **Automated onboarding + payments** (Stripe / eSewa / Khalti) → self-serve org + device provisioning (`03 §7` hook).
- **Smarter irrigation:** ET₀/FAO-56 weather-aware scheduling; crop models; per-zone dosing recipes (hardware change).
- **Analytics/ML:** water/fertilizer savings reports, anomaly detection, yield correlation, recommendations.
- **Scale path:** option to migrate to AWS (IoT Core + ECS + RDS) or horizontally scale the VPS stack for a larger fleet (`01 §8`).
- White-labelling/theming; public API; integrations (weather APIs, marketplaces).

---

## Milestone summary

| Phase | Headline | Est. | Key risk retired |
|---|---|---|---|
| 0 | Single-zone prototype + cloud skeleton | 2–3 wk | Sensors read, valve safe, ingest works |
| 1 | **MVP: one farm, multi-tenant** | 6–10 wk | Full automation + provisioning + offline resilience |
| 2 | Hardening + multi-farm + solar + OTA | 6–10 wk | Field robustness at small scale |
| 3 | Payments, smarts, scale | ongoing | Commercial scale |

---

## Risk register

| Risk | Impact | Likelihood | Mitigation |
|---|---|---|---|
| NPK sensor protocol/register surprises | Med | Med | Decode in Phase 0; vendor datasheet; config-driven map |
| LoRa range/interference on real fields | High | Med | Site survey (`06 §1`); fallback WiFi/wired; antenna placement |
| Pump/plumbing/dosing complexity | High | Med | Prototype fertigation rig early; flow meter; safety guards |
| Outdoor power (heat, brownout, solar sizing) | Med | Low–Med | **ESP32 brain runs cool, sips power, restarts instantly** — small solar kit; pump on its own supply; heatsink/venting only if using the optional RPi |
| SD-card / storage corruption | Low | Low | ESP32 uses SD only as a buffer (not to boot), so a corrupt card doesn't stop control; high-endurance card; applies mainly to the optional RPi (read-mostly root, clean-shutdown UPS) |
| Multi-tenant data leakage | High | Low | Strict scoping middleware + audits + RLS in Phase 2 |
| Scope creep (full SaaS at once) | High | Med | Prove one farm first within the multi-tenant shell |
| Calibration drift in the field | Med | Med | Documented re-cal schedule (`06`), plausibility checks/alerts |
| Single-VPS outage | Med | Low | Backups + quick restore; edge keeps watering regardless |

---

## Dependencies & assumptions
- BOM additions (pump, valves, dosing, LoRa, power) procured before Phase 1 (`05`).
- A willing **pilot farm** with a defined crop and water source.
- Team skills: embedded **C/C++ (ESP32)** + Node/React/React Native + light DevOps (Python only if the optional RPi gateway is used).
- Connectivity available (WiFi or a data SIM) at the pilot site.

## Definition of done (global)
A phase is done when its exit criteria are met **and**: documented (these files updated), tested (unit + the relevant field/integration test), and reversible/safe (fail-closed verified, backups working).
