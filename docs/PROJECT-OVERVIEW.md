# 🌱 TERANODE — Project Overview & Architecture (Visual)

> A single compiled picture of the whole product: the idea, the system, the data, the
> flows, and how it runs. Diagrams are [Mermaid](https://mermaid.js.org) — they render on
> GitHub, in VS Code (with a Mermaid extension), and in most Markdown viewers.
> Companion docs: [01-System-Architecture](./01-System-Architecture.md) ·
> [02-IoT-Hardware-and-Firmware](./02-IoT-Hardware-and-Firmware.md) ·
> [BUILD-SPEC](./BUILD-SPEC.md) (as-built spec) · [../RUN.md](../RUN.md) (how to run).

---

## 1. The idea

**The problem.** Smallholder vegetable farmers water and feed by habit and guesswork.
Over‑/under‑watering wastes water and power, leaches nutrients, and costs yield. Soil
moisture, pH, EC and N‑P‑K vary by zone and shift as a crop grows — but nobody can watch
all of that by hand, and the internet/power at a farm is unreliable.

**The product.** TERANODE is a **crop‑driven smart irrigation + fertigation system**. A
field "brain" (an **ESP32 gateway**) reads per‑zone soil sensors and a weather mast, and
drives a pump + per‑zone valves + nutrient dosing — **running the irrigation logic locally
even with no internet**, and syncing to the cloud when it can. The farmer **picks the crop
for each zone**; the system then knows that crop's ideal ranges for every growth stage and
**auto‑tunes the watering/feeding targets**, scores each zone's health 0–100, and tells the
farmer in plain language (English/Nepali) what to do next.

**Who uses it.**
- **Admin** (the company) — a **web console**: creates customer accounts, registers + binds
  ESP32 gateways, watches the whole fleet, pushes firmware (OTA), edits the crop library and
  per‑customer device entitlements, and reviews an audit trail.
- **Customer / farmer** — a **mobile app**: a live, crop‑aware dashboard of their field,
  per‑zone health + coaching, a guided "assign a crop + its sensors" flow, manual valve
  override, analytics & water/fertilizer savings, harvest log, and alerts.

**Why it's different:** edge‑first (crops can't wait for the cloud), **crop‑aware agronomy**
(not just generic thresholds), modular hardware (turn device classes on/off per customer),
and fully **simulation‑driven** so the whole thing is demoable without a single sensor.

---

## 2. System context

```mermaid
flowchart LR
  admin(["👨‍💼 Admin<br/>(company)"])
  farmer(["👩‍🌾 Customer / Farmer"])
  field["🌾 Field hardware<br/>ESP32 gateway · zone nodes<br/>sensors · pump · valves · dosing"]

  subgraph TERANODE["TERANODE platform"]
    web["🖥️ Web Admin<br/>(React + Vite)"]
    mobile["📱 Mobile App<br/>(React Native / Expo)"]
    cloud["☁️ Cloud backend<br/>API · ingest · DB · broker"]
  end

  admin --> web
  farmer --> mobile
  web <--> cloud
  mobile <--> cloud
  field <== "MQTT/TLS<br/>(WiFi / 4G)" ==> cloud
  cloud -. "commands / config" .-> field
```

The cloud is the **source of truth for configuration** (crops, rules, schedules, dosing) and
the **system of record for history**; the gateway is the **real‑time controller** at the edge.

---

## 3. End‑to‑end architecture

```mermaid
flowchart TB
  subgraph EDGE["FIELD — per farm (offline-capable)"]
    direction TB
    N["Zone nodes<br/>ESP32 + moisture/pH/EC/NPK/soil-temp + valve"]
    WX["Weather mast<br/>air temp · humidity · pressure · rain"]
    GW["Gateway brain (ESP32)<br/>• runs control loop locally<br/>• drives pump + dosing<br/>• buffers to flash, back-fills"]
    N -- "LoRa" --> GW
    WX -- "wired" --> GW
  end

  GW <== "MQTT over TLS" ==> MB

  subgraph CLOUD["CLOUD — Docker Compose on a VPS"]
    MB["Mosquitto<br/>MQTT broker"]
    ING["@teranode/ingest<br/>MQTT → DB/Redis worker<br/>+ virtual gateway (hardware-free)"]
    API["@teranode/api<br/>Express REST + WebSocket"]
    PG[("PostgreSQL + TimescaleDB<br/>relational + time-series")]
    RD[("Redis<br/>pub/sub + refresh tokens")]
    NG["Nginx (TLS)"]
    MB --> ING --> PG
    ING --> RD
    API --> PG
    API --> RD
    API -- "publish cmd/config" --> MB
    RD -. "live fan-out" .-> API
    NG --> API
  end

  NG --> WEB["🖥️ Web Admin (Vite)"]
  NG --> APP["📱 Mobile App (Expo)"]
  API == "WebSocket /live" ==> APP
  API == "WebSocket /live" ==> WEB
```

**Edge‑first control:** the irrigation/fertigation decision lives on the gateway, so the farm
keeps watering correctly through cloud/internet/power blips; telemetry is buffered and
back‑filled on reconnect. The **virtual gateway** in `@teranode/ingest` replays the same
control logic over MQTT, so the entire cloud lights up with **no hardware**.

---

## 4. Monorepo & module map

```mermaid
flowchart TD
  subgraph packages["packages/ (shared TS source)"]
    T["@teranode/types<br/>entities · enums · DTOs · WS msgs · MQTT vocab"]
    AG["@teranode/agronomy<br/>14-crop library + pure engine"]
  end
  subgraph apps["apps/"]
    API["@teranode/api<br/>Express REST + WS · Drizzle · JWT"]
    ING["@teranode/ingest<br/>MQTT worker + virtual gateway"]
    WEB["@teranode/web<br/>React + Vite admin"]
    MOB["@teranode/mobile<br/>Expo RN customer app"]
  end
  subgraph infra["infra/"]
    DC["docker-compose<br/>Timescale · Redis · Mosquitto · Nginx"]
  end
  FW["firmware/ — ESP32 Wokwi sketch"]
  SIM["simulator/ — HTML digital twin"]

  T --> AG
  T --> API
  T --> ING
  T --> WEB
  T --> MOB
  AG --> API
  AG --> ING
  AG --> WEB
  AG --> MOB
  API -. uses .-> DC
  ING -. uses .-> DC
```

The shared packages are the **single source of truth**: the same `analyzeZone` agronomy
engine runs in the API, the ingest worker, the web admin, and the mobile mock — so a zone's
health score and recommendations are identical everywhere.

---

## 5. Roles & tenancy (2‑role model)

```mermaid
flowchart TD
  ROOT["🏢 Admin account<br/>(type=admin, parent_id = NULL)"]
  U1["👨‍💼 admin user<br/>role=admin"]
  ROOT --- U1

  ROOT --> C1["🌾 Customer A<br/>(type=customer)"]
  ROOT --> C2["🌾 Customer B"]
  ROOT --> C3["🌾 Customer C ..."]

  C1 --> CU1["👩‍🌾 customer user<br/>role=customer"]
  C1 --> F1["Farm → Zones → (crop · sensors · valve)"]

  classDef admin fill:#e4efe2,stroke:#3f6b4e;
  classDef cust fill:#f2e7da,stroke:#bd6a43;
  class ROOT,U1 admin;
  class C1,C2,C3,CU1,F1 cust;
```

- **Tenant boundary = the customer account.** Every tenant‑owned row carries `account_id`.
- **Admin** sees/does everything (create customers, bind gateways, fleet, OTA, edit any
  customer's entitlements — no create‑time lock). **Customer** is scoped to its own account.
- Enforced in middleware: `requireAuth` → `requireAdmin` / `scopeToCustomer`. JWT carries
  `userId, accountId, accountType, role`.

---

## 6. Data model (entity‑relationship)

```mermaid
erDiagram
  ACCOUNTS ||--o{ USERS : has
  ACCOUNTS ||--o{ ACCOUNTS : "parent_of"
  ACCOUNTS ||--o{ FARMS : owns
  ACCOUNTS ||--|| ENTITLEMENT_RECORDS : has
  ACCOUNTS ||--o{ ALERTS : raises
  USERS ||--o{ AUDIT_LOG : acts

  FARMS ||--|| GATEWAYS : "has one"
  FARMS ||--o{ ZONES : "split into"
  FARMS ||--o{ SCHEDULES : windows
  FARMS ||--|| DOSING_PROFILES : recipe
  FARMS ||--o{ USAGE_EVENTS : meters

  GATEWAYS ||--o{ NODES : hosts
  GATEWAYS ||--o{ DEVICE_TOKENS : auth

  CROPS ||--o{ CROP_STAGES : stages
  CROPS ||--o{ ZONES : "planted in"

  ZONES ||--o{ SENSOR_CHANNELS : exposes
  ZONES ||--|| RULES : "controlled by"
  ZONES ||--o{ ACTUATORS : "valve/pump"
  ZONES ||--o{ HARVEST_LOG : harvests
  ZONES }o--|| NODES : "bound to"

  SENSOR_CHANNELS ||--o{ TELEMETRY : records

  ACCOUNTS {
    uuid id PK
    account_type type
    uuid parent_id FK
    text name
    account_status status
    text locale
  }
  USERS {
    uuid id PK
    uuid account_id FK
    citext email
    user_role role
    text password_hash
  }
  CROPS {
    text id PK
    text name_en
    text category
    int days_to_harvest
    jsonb ideal
    jsonb acceptable
  }
  CROP_STAGES {
    text id PK
    text crop_id FK
    text stage
    int start_day
    jsonb ideal
    jsonb acceptable
  }
  FARMS {
    uuid id PK
    uuid account_id FK
    text name
    text timezone
  }
  GATEWAYS {
    uuid id PK
    text serial
    uuid farm_id FK
    gw_status status
    timestamptz last_seen
  }
  NODES {
    uuid id PK
    uuid gateway_id FK
    int battery
  }
  ZONES {
    uuid id PK
    uuid farm_id FK
    text crop_id FK
    date planting_date
    uuid node_id FK
    text mode
  }
  SENSOR_CHANNELS {
    uuid id PK
    uuid zone_id FK
    channel_type type
    text unit
  }
  RULES {
    uuid zone_id PK
    numeric moisture_low
    numeric moisture_high
    numeric ph_target
    numeric ec_target
    text source
  }
  ACTUATORS {
    uuid id PK
    actuator_scope scope
    actuator_type type
    bool state
    bool desired
  }
  TELEMETRY {
    timestamptz time
    uuid channel_id FK
    uuid zone_id
    double value
  }
  USAGE_EVENTS {
    timestamptz time
    uuid farm_id
    text kind
    double value
  }
  ALERTS {
    uuid id PK
    uuid account_id FK
    alert_sev severity
    text type
    text message_en
  }
  HARVEST_LOG {
    uuid id PK
    uuid zone_id FK
    text crop_id FK
    numeric yield_kg
  }
  ENTITLEMENT_RECORDS {
    uuid account_id PK
    jsonb values
  }
  SCHEDULES {
    uuid id PK
    uuid farm_id FK
    int window_start_hour
    int window_end_hour
    bool et0_aware
  }
  DOSING_PROFILES {
    uuid farm_id PK
    numeric ec_target
    numeric ph_target
  }
  DEVICE_TOKENS {
    uuid id PK
    uuid gateway_id FK
    text secret_hash
  }
  AUDIT_LOG {
    uuid id PK
    uuid actor_id FK
    text action
    jsonb before
    jsonb after
  }
```

High‑volume readings (`TELEMETRY`, `USAGE_EVENTS`) are **TimescaleDB hypertables** with
**continuous aggregates** `telemetry_5m / 1h / 1d` and `usage_1d` for fast charts, plus 90‑day
retention + compression. `DEVICE_CATALOG` (not shown) is the data‑driven module list that
`ENTITLEMENT_RECORDS.values` references.

---

## 7. Crop library & growth stages

14 vegetables ship in `@teranode/agronomy` (data‑driven — adding a crop is one file):

| 🍅 tomato | 🫑 capsicum | 🌶️ chili | 🥒 cucumber | 🥬 spinach | 🥗 lettuce | 🥬 cabbage |
|---|---|---|---|---|---|---|
| 🥦 **cauliflower** | 🧅 **onion** | 🥕 **carrot** | 🥔 **potato** | 🍆 **eggplant** | 🌿 **okra** | 🫘 **beans** |

Each crop carries English + Nepali names, category, days‑to‑harvest, and a **stage timeline**
where the ideal/acceptable bands (moisture, pH, EC, N, P, K, soil‑temp, air‑temp) shift over
time:

```mermaid
stateDiagram-v2
  direction LR
  [*] --> Germination
  Germination --> Vegetative : day ≥ startDay
  Vegetative --> Flowering : fruiting crops
  Flowering --> Fruiting
  Fruiting --> Harvest
  Vegetative --> Harvest : leafy / root crops
  Harvest --> [*]
  note right of Vegetative
    bands per stage, e.g. tomato:
    germ  moisture 65-80, EC 1.0-1.5, N 60-90
    veg   moisture 60-75, EC 1.8-2.5, N 120-150
    flwr  EC 2.2-3.0, P 50-70, K 180-220
    fruit moisture 65-75, EC 2.5-3.5, K 200-280
  end note
```

The current stage is **derived from `planting_date`**, so the targets a zone is held to move
automatically as the crop matures.

---

## 8. Agronomy engine pipeline

```mermaid
flowchart LR
  R["Live readings<br/>(latest per channel)"] --> AZ
  C["Crop + planting_date"] --> ST["currentStage()"]
  ST --> BAND["stage ideal/acceptable band"]
  BAND --> AZ["analyzeZone()"]
  R --> AZ
  AZ --> CH["evaluateChannels()<br/>below / in / above per channel"]
  AZ --> H["zoneHealth() → 0–100<br/>weighted: moisture .30, pH/EC .15,<br/>NPK .10 each, temps .05"]
  AZ --> RC["recommendations()<br/>plain language (en/ne)"]
  AZ --> DR["deriveRule()<br/>moisture low/high + pH/EC targets"]
  DR --> RULES[("zones → rules<br/>source = crop")]
  H --> UI["📱 Health ring + 🖥️ dashboards"]
  RC --> UI
  CH --> UI
```

Pure, deterministic, and unit‑tested (**72 tests**). Example output: *"N is 80 mg/kg vs
120–150 target for the fruiting stage — increase nutrient dosing."* Picking a crop for a zone
runs `deriveRule()` and writes the zone's control thresholds automatically.

---

## 9. Key flows (sequences)

### 9.1 Auth (JWT access + rotating refresh)

```mermaid
sequenceDiagram
  participant C as Client (web/app)
  participant API as API
  participant DB as Postgres
  participant R as Redis
  C->>API: POST /auth/login {email, password}
  API->>DB: find user by email
  API->>API: bcrypt.compare(password)
  API->>R: store refresh token
  API-->>C: { accessToken (15m), refreshToken, user, account }
  Note over C,API: access token sent as Bearer on every call
  C->>API: GET /me (Bearer)
  API-->>C: { user, account }
  C->>API: POST /auth/refresh (when access expires)
  API->>R: rotate refresh
  API-->>C: new access + refresh
```

### 9.2 Admin onboards a customer + binds a gateway

```mermaid
sequenceDiagram
  participant A as Admin (web)
  participant API as API
  participant DB as Postgres
  A->>API: POST /admin/customers {name, owner email/pw, entitlements}
  API->>DB: create customer account + owner user + entitlement_records
  API->>DB: audit_log (create_customer)
  API-->>A: customer + one-time owner credentials
  A->>API: POST /admin/gateways {serial}
  API->>DB: create unbound gateway + device_token (hashed)
  API-->>A: device token (shown once)
  A->>API: POST /admin/gateways/:id/bind {farmId}
  API->>DB: gateway.farm_id + account_id, status → offline→online on first telemetry
  API-->>A: bound
```

### 9.3 Farmer assigns a crop + sensors to a zone

```mermaid
sequenceDiagram
  participant F as Farmer (app)
  participant API as API
  participant AG as Agronomy engine
  participant DB as Postgres
  F->>API: POST /zones/:id/assign {cropId, plantingDate, nodeId, channels[]}
  API->>DB: set zone.crop_id, planting_date, node_id
  API->>DB: create sensor_channels for the zone
  API->>AG: currentStage(crop, plantingDate) → deriveRule()
  API->>DB: upsert rules {moisture_low/high, ph/ec target, source=crop}
  API->>AG: analyzeZone(readings)
  API-->>F: { zone, channels, rule, analysis (stage, health, recs) }
```

### 9.4 Live telemetry round‑trip (hardware‑free)

```mermaid
sequenceDiagram
  participant VG as Virtual gateway
  participant MB as Mosquitto
  participant ING as Ingest worker
  participant DB as TimescaleDB
  participant R as Redis
  participant API as API (WS /live)
  participant APP as Mobile/Web
  loop every SIM_TICK_MS
    VG->>VG: run hysteresis (drift moisture, valve, pump)
    VG->>MB: publish telemetry/zone/{id} {moisture, ph, ec, npk, valve...}
  end
  MB->>ING: deliver message
  ING->>DB: insert telemetry rows (+ usage_events)
  ING->>DB: update actuators.state
  ING->>R: publish live:farm:{id} / live:zone:{id}
  R-->>API: pmessage
  API-->>APP: WS push {type: telemetry, value...}
  APP->>APP: update gauges + health ring live
```

### 9.5 Actuator command (desired‑vs‑reported)

```mermaid
sequenceDiagram
  participant F as Farmer (app)
  participant API as API
  participant MB as Mosquitto
  participant GW as Gateway
  F->>API: POST /actuators/:id/command {action: open}
  API->>API: set actuators.desired = true
  API->>MB: publish cmd/zone/{id} (QoS 1)
  Note over F,API: UI shows "pending" (desired ≠ reported)
  GW->>GW: actuate valve
  GW->>MB: publish state/zone/{id} {valve: open} (retained)
  MB->>API: ingest → actuators.state = true
  API-->>F: WS push → UI shows "reported: open"
```

---

## 10. Edge control loop (per zone, per cycle)

```mermaid
flowchart TD
  S(["every control cycle"]) --> M{mode == manual?}
  M -- yes --> HM["honor manual valve state"] --> P
  M -- no --> RN{rain_1h ≥ rain_skip_mm?}
  RN -- yes --> C1["close valve · RAIN-SKIP"] --> P
  RN -- no --> W{within watering window?}
  W -- no --> C2["close valve · OUTSIDE-WINDOW"] --> P
  W -- yes --> LO{moisture < moisture_low?}
  LO -- yes --> OP["open valve · IRRIGATE"] --> SF
  LO -- no --> HI{moisture > moisture_high?}
  HI -- yes --> C3["close valve · TARGET REACHED"] --> P
  HI -- no --> HD["hold state · in band"] --> P
  SF{open longer than max_run?} -- yes --> C4["close · MAX-RUN STOP (safety)"] --> P
  SF -- no --> P
  P["pump ON if any valve open · dose while pumping (EC/pH targets)"] --> E([done])
```

The same hysteresis runs on the ESP32 firmware, in the virtual gateway, and in the mobile
mock — one behavior, three places.

### Valve state (auto mode)

```mermaid
stateDiagram-v2
  direction LR
  [*] --> Closed
  Closed --> Open : moisture < low
  Open --> Open : in band (topping up)
  Open --> Closed : moisture > high
  Open --> Closed : rain-skip / outside window / max-run
  Closed --> Open : manual open
  Open --> Closed : manual close
```

---

## 11. MQTT topic scheme

```text
teranode/{accountId}/{farmId}/{gatewayId}/...
  telemetry/zone/{zoneId}      gateway → cloud   batched zone readings
  telemetry/weather            gateway → cloud   air temp/humidity/pressure/rain
  telemetry/gateway/health     gateway → cloud   liveness heartbeat
  state/zone/{zoneId}          gateway → cloud   retained: valve/pump/mode (reported)
  cmd/zone/{zoneId}            cloud → gateway   open/close, set thresholds
  cmd/gateway/config           cloud → gateway   retained: rules/schedule/dosing push
```

Telemetry up (QoS 1, deduped), commands down (QoS 1), retained **desired/reported state**, and
Last‑Will marks a gateway offline within seconds → drives the offline alert. Each device is
ACL‑scoped to its own subtree.

---

## 12. API surface (2‑role)

```mermaid
flowchart LR
  subgraph public["public"]
    L["POST /auth/login · /refresh · /logout"]
  end
  subgraph any["any authed"]
    ME["GET /me · /me/entitlements"]
    CR["GET /crops · /crops/:id"]
    DC["GET /device-catalog"]
  end
  subgraph adminOnly["admin only"]
    AC["/admin/customers (+ /:id/entitlements)"]
    AF["/admin/fleet · /admin/gateways(/bind /ota)"]
    AU["/admin/audit"]
    CW["POST/PATCH /crops (+ /stages)"]
  end
  subgraph cust["customer-scoped"]
    FA["/farms (+ /:id/zones)"]
    ZO["/zones (+ /:id/assign · /:id/analysis · /:id/telemetry)"]
    RU["/rules/zones/:id · /rules/farms/:id/schedules · /dosing-profile"]
    AT["POST /actuators/:id/command"]
    AL["/alerts (+ /:id/ack)"]
    HV["/harvest"]
    AN["/analytics/usage · /savings · /export(csv)"]
  end
  WS["WebSocket /live?token= → subscribe {farmId|zoneId}"]
```

---

## 13. Deployment topology

```mermaid
flowchart TB
  subgraph VPS["VPS (Ubuntu + Docker Compose)"]
    direction TB
    NG["nginx :8080 (TLS)"]
    API["api :4000 (REST + WS)"]
    ING["ingest worker (+ virtual gateway)"]
    PG[("timescaledb :5432→5433")]
    RD[("redis :6379→6380")]
    MB["mosquitto :1883 / :9001"]
    NG --> API
    API --> PG
    API --> RD
    ING --> PG
    ING --> RD
    ING <--> MB
    API --> MB
  end
  DEV["dev machine: web :5173 · expo :8081"] --> NG
  GW["field gateways"] <== "MQTT/TLS" ==> MB
```

> On this build machine the host already runs Postgres/Redis, so containers are mapped to
> **5433 / 6380** (see `.env` + `RUN.md`).

---

## 14. User journeys

```mermaid
journey
  title Customer / Farmer — daily use
  section Onboard
    Receive login from admin: 3: Farmer
    Open app, see field dashboard: 5: Farmer
  section Set up a zone
    Pick a crop from the library: 5: Farmer
    Set planting date, bind ESP32 + sensors: 4: Farmer
    Targets auto-applied for the crop stage: 5: Farmer
  section Daily
    Check zone health rings: 5: Farmer
    Read the coach card recommendation: 5: Farmer
    Acknowledge an alert: 4: Farmer
    Override a valve when needed: 4: Farmer
  section Harvest
    Log yield, view water/fertilizer savings: 5: Farmer
```

```mermaid
journey
  title Admin — onboarding & operations
  section Provision
    Create customer + owner login: 5: Admin
    Register gateway serial, issue token: 4: Admin
    Bind gateway to the customer farm: 5: Admin
  section Operate
    Watch fleet health (online/offline): 5: Admin
    Push OTA firmware: 3: Admin
    Edit a customer's device entitlements: 4: Admin
    Curate the crop library: 4: Admin
    Review the audit log: 4: Admin
```

---

## 15. How it was built (and verified)

```mermaid
flowchart LR
  P0["P0 · Foundation<br/>monorepo reshape"] --> P1["P1 · Shared<br/>types + agronomy<br/>(72 tests ✓)"]
  P1 --> P2["P2 · Backend base<br/>Docker + DB + auth ✓"]
  P2 --> P3["P3 · Routes<br/>6 feature groups ✓"]
  P2 --> P4["P4 · Realtime<br/>ingest + virtual gw + WS ✓"]
  P1 --> P5["P5 · Clients<br/>web admin + RN app ✓"]
  P3 --> P6["P6 · Cutover<br/>e2e verify + RUN.md ✓"]
  P4 --> P6
  P5 --> P6
```

| Layer | Verified |
|---|---|
| Agronomy engine | 72/72 unit tests pass |
| Database | migrate (hypertables + CAGGs) + seed (14 crops, demo tenant) |
| Auth & RBAC | both roles login; customer→admin = 403 |
| REST | all route groups return 200 for the right role |
| Realtime | virtual gateway → ingest → Timescale → Redis → **WS push received**; zone health 0 → 85 on live data |
| Web admin | `vite build` clean; talks to live API |
| Mobile app | typecheck clean; Metro bundle builds; runs on simulation mock |

---

### Legend / conventions
- **Health score** 0–100 per zone; ≥80 green, 50–79 amber, <50 red.
- **Channels:** moisture %, pH, EC mS/cm, N/P/K mg/kg, soil/air temp °C, humidity %, rain mm.
- **Demo logins:** `admin@teranode.io` (web) · `farmer@greenvalley.np` (app) — password `teranode`.

*Generated as the compiled architecture overview. To render to PNG/SVG, use the Mermaid CLI or paste any block into mermaid.live.*
