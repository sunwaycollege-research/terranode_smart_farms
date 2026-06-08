# System Architecture

TERANODE is an **npm‑workspaces monorepo** that delivers one product across four runtimes —
**firmware**, a **cloud backend**, a **web admin panel**, and a **mobile farmer app** — bound
together by two shared TypeScript packages and three integration contracts (MQTT, REST, and the
Postgres schema).

## 1. Design principles

```{list-table}
:header-rows: 1
:widths: 24 76

* - Principle
  - What it means in TERANODE
* - **Offline‑first edge**
  - The gateway runs the full irrigation control loop locally. Cloud/internet outages never stop watering; the cloud is for insight, history, and remote control — not the control path.
* - **Device‑id‑first provisioning**
  - A flashed device knows only its own `{serial, secret}`. It phones home (`POST /provision`); the backend resolves which customer/farm it belongs to. Zero manual pairing in the field.
* - **Two roles, hard tenant scoping**
  - Exactly two roles — **admin** (the company operator) and **customer** (the farmer). Every query is scoped to the caller's account server‑side; a customer can never reach another tenant's data.
* - **Crop‑driven, not raw numbers**
  - A shared agronomy engine turns sensor readings into a 0–100 health score, stage‑aware target bands, and plain‑language bilingual (EN/NE) guidance.
* - **Capability entitlements**
  - What a customer can see/do is gated by a per‑account entitlement record seeded from a device catalog (e.g. how many zone nodes they bought, whether analytics is on).
* - **Single source of truth, shared types**
  - `@teranode/types` (wire/DB shapes) and `@teranode/agronomy` (the engine) are imported by the API, ingest, web, and mobile so the contract can't drift.
```

## 2. Monorepo layout

```
TerraNode/
├── apps/
│   ├── api/        Express REST + WebSocket backend (Node, tsx)
│   ├── ingest/     MQTT → DB/Redis worker + virtual gateway / device simulator
│   ├── web/        React + Vite admin panel (operator)
│   └── mobile/     Expo React Native app (farmer)
├── packages/
│   ├── types/      Shared entities, DTOs, enums, MQTT + WS contracts, device catalog
│   └── agronomy/   Crop library (14+ crops) + the analysis/recommendation engine
├── firmware/       ESP32 gateway firmware (connected) + base sketch + Wokwi diagram
├── TerraNode/      Hardware: pins.csv, assembly.md, BOM, the standalone device sketch + Wokwi
├── infra/          docker-compose (TimescaleDB, Redis, Mosquitto, nginx) + broker config
├── simulator/      Browser digital‑twin HTML (visualisation, no backend needed)
└── docs/           This documentation site (Sphinx) + strategy/product Markdown
```

See {doc}`../components/packages` for the shared packages and {doc}`../components/api`,
{doc}`../components/ingest`, {doc}`../components/web`, {doc}`../components/mobile` for each app.

## 3. Component responsibilities

```{list-table}
:header-rows: 1
:widths: 18 14 68

* - Component
  - Runtime
  - Responsibility
* - **Firmware** ({doc}`../components/firmware`)
  - ESP32 (C++)
  - Read sensors (7‑in‑1 RS485 soil, DHT22, rain, flow), run the edge control loop (hysteresis + rain‑skip + window + max‑run + leak detection), provision via HTTP, publish telemetry + state over MQTT, accept retained config/commands.
* - **Mosquitto** ({doc}`../components/infra`)
  - Docker
  - MQTT broker. Devices publish telemetry/state; the API publishes retained commands.
* - **Ingest** ({doc}`../components/ingest`)
  - Node (tsx)
  - Subscribe to MQTT, resolve `serial → account/farm/zone`, write telemetry to TimescaleDB, fan out live updates to Redis, derive actuator state + usage, and run liveness (online/offline) alerting. Also hosts the **virtual gateway** + **device simulator** for hardware‑free runs.
* - **API** ({doc}`../components/api`)
  - Node (Express)
  - REST + `/live` WebSocket. Auth (JWT access/refresh), tenant scoping, customers/fleet/entitlements (admin), farms/zones/crops/analytics/alerts (customer), `POST /provision` (device‑facing), and command publishing to MQTT.
* - **Web** ({doc}`../components/web`)
  - Browser (React/Vite)
  - Operator console: customers + entitlements, device fleet health, crop library, analytics, audit.
* - **Mobile** ({doc}`../components/mobile`)
  - Expo (React Native)
  - Farmer app: live crop‑aware dashboard, per‑zone detail + valve control, nutrient/fertilizer guidance, alerts, analytics, device onboarding, self‑service zone creation.
* - **TimescaleDB / Redis**
  - Docker
  - Postgres + Timescale hypertables for telemetry/usage; Redis as the live pub/sub bus between ingest and the API WebSocket.
```

## 4. Technology stack

```{list-table}
:header-rows: 1
:widths: 22 78

* - Layer
  - Technologies
* - Firmware
  - ESP32 (Arduino C++), ModbusMaster, DHT, PubSubClient (MQTT), ArduinoJson, HTTPClient, Preferences (NVS), SoftAP provisioning.
* - Backend
  - Node + TypeScript (run via `tsx`), Express, Drizzle ORM, `pg`, `ioredis`, `mqtt`, `jsonwebtoken`, `bcryptjs`, `ws`.
* - Data
  - PostgreSQL + **TimescaleDB** (hypertables, continuous aggregates, retention/compression), **Redis** (live bus), **Mosquitto** (MQTT).
* - Web
  - React 18, Vite, TypeScript, react‑router, react‑i18next, recharts, lucide‑react.
* - Mobile
  - Expo + React Native, expo‑router, expo‑secure‑store, AsyncStorage, custom theme + i18n (EN/NE), `@expo/vector-icons`.
* - Shared
  - `@teranode/types`, `@teranode/agronomy` (pure, deterministic, unit‑tested).
```

## 5. The four planes

A useful mental model is to separate TERANODE into four planes:

```{mermaid}
flowchart TB
  subgraph DATA["📈 Data plane (high volume)"]
    direction LR
    d1["device telemetry"] --> d2["Mosquitto"] --> d3["ingest"] --> d4["TimescaleDB"] --> d5["Redis live bus"] --> d6["WS → apps"]
  end
  subgraph CTRL["🎛 Control plane"]
    direction LR
    c1["app/operator action"] --> c2["API"] --> c3["retained cmd on MQTT"] --> c4["device acts"] --> c5["state report"] --> c6["ingest reconciles"]
  end
  subgraph MGMT["🗂 Management plane"]
    direction LR
    m1["operator: customers,\nentitlements, fleet"] --> m2["API admin routes"] --> m3["Postgres"]
  end
  subgraph PROV["🔑 Provisioning plane"]
    direction LR
    p1["register device"] --> p2["claim to customer"] --> p3["device POST /provision"] --> p4["auto-create farm/zone/channels"]
  end
```

- **Data plane** — the firehose: readings flow device → broker → ingest → Timescale, then live to apps via Redis + the `/live` WebSocket. Covered in {doc}`data-flow`.
- **Control plane** — desired‑vs‑reported actuation: an app/operator command becomes a retained MQTT message; the device acts and reports back; ingest reconciles. Covered in {doc}`data-flow`.
- **Management plane** — the operator administering customers, entitlements, and the device fleet via the admin API. Covered in {doc}`../components/api` and {doc}`../reference/entitlements`.
- **Provisioning plane** — the device lifecycle from factory to live. Covered in {doc}`device-lifecycle`.

## 6. Integration contracts

Everything that crosses a process boundary is pinned by one of three contracts. These are the
"API surface" of the system and are documented in {doc}`../reference/mqtt-topics`,
{doc}`../reference/rest-api`, and {doc}`../reference/data-model`:

1. **MQTT** — device ⇄ cloud telemetry, state, health, and commands.
2. **REST + WebSocket** — apps ⇄ API, and the device‑facing `POST /provision`.
3. **Postgres schema** — the durable system of record (typed via Drizzle + `@teranode/types`).
