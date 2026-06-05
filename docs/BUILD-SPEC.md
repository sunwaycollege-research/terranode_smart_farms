# TERANODE — Authoritative Build Spec (read fully before writing code)

> This is the single source of truth for the autonomous build. Every workflow agent
> MUST read this file fully before doing anything. Repo root is the cwd. The repo is a
> **2-role, crop-driven** rebuild of a former 3-tier PoC. Phase 0 (monorepo reshape) is
> already done — do not reshape.

---

## 0. Conventions (MANDATORY)

- **Monorepo (npm workspaces):**
  - `apps/mobile` — Expo SDK 55 RN customer app (`@teranode/mobile`, React 19).
  - `apps/web` — Vite + React 18 + TS admin (`@teranode/web`).
  - `apps/api` — Express REST + WebSocket (`@teranode/api`), ESM, run via **tsx**.
  - `apps/ingest` — MQTT worker + virtual gateway (`@teranode/ingest`), ESM, tsx.
  - `packages/types` — `@teranode/types` (entities, enums, DTOs, device catalog, WS msgs).
  - `packages/agronomy` — `@teranode/agronomy` (crop library + pure engine).
  - `infra/` — docker-compose, nginx, mosquitto, postgres, migrations.
- **Imports:** in `packages/*` and `apps/api|ingest` use **EXTENSIONLESS** relative imports
  (`./foo`, not `./foo.js`). tsconfig is `moduleResolution: Bundler`; api/ingest run via tsx.
- **No new npm installs** unless unavoidable and you are the only agent in your phase.
  Already installed: api/ingest → `express cors drizzle-orm pg ioredis jsonwebtoken bcryptjs ws mqtt zod nanoid` (+dev `tsx typescript drizzle-kit vitest supertest`); web → `react@18 react-dom@18 react-router-dom@6 i18next react-i18next recharts vite @vitejs/plugin-react`; mobile → `expo react@19 react-native react-native-svg @react-native-async-storage/async-storage i18next react-i18next`. **Hand-roll CSV** (no csv lib).
- **Password hashing:** use `bcryptjs` (pure JS; argon2 dropped to avoid native builds).
- **File ownership (critical):** each unit owns a DISJOINT set of files (see §8). Never write
  a file owned by another unit. `apps/api/src/index.ts` is owned by unit 2.3 and frozen after.
- **Self-check:** before finishing, run the relevant `npm run -w <workspace> typecheck`
  (and `test` for agronomy) and fix YOUR errors.
- **Design language:** parchment + soil palette. Mobile tokens: `apps/mobile/src/theme/tokens.ts`
  (read it). Reuse the GaugeRing / BarMeter look. Web ports the same palette to CSS variables.
- **Env:** see root `.env.example`. `DATABASE_URL`, `REDIS_URL`, `MQTT_URL`, `JWT_ACCESS_SECRET`,
  `JWT_REFRESH_SECRET`, `PORT=4000`.

---

## 1. Two-role model

- `accounts.type ∈ {admin, customer}`. Single **admin root** (`parent_id NULL`); every
  `customer.parent_id = admin root id`.
- `users.role ∈ {admin, customer}` (Postgres enum, kept extensible for future
  customer_operator/viewer — do not add them now).
- **Admin** does everything: create/disable customers, register + bind ESP32 gateways, fleet
  health, OTA, and edit ANY customer's device entitlements (no lock — admin can always edit).
- **Customer** (farmer): manages own farm(s)/zone(s) from the RN app; scoped to own `account_id`.
- The old `company/retailer/farmer` tiers, `retailer_admin`, and the create-time entitlement
  **lock** are REMOVED.

---

## 2. Data model (Postgres + TimescaleDB)

Single DB, TimescaleDB extension. Tenant boundary = the **customer** account; every
tenant-owned row carries `account_id` referencing a customer account. Use Drizzle ORM for typed
queries (`apps/api/src/db/schema.ts`) and a **raw-SQL idempotent migration** for DDL incl.
hypertables/continuous-aggregates (`apps/api/src/db/migrate.ts`).

```sql
CREATE EXTENSION IF NOT EXISTS timescaledb;
CREATE EXTENSION IF NOT EXISTS pgcrypto;   -- gen_random_uuid
CREATE EXTENSION IF NOT EXISTS citext;

-- accounts & users -------------------------------------------------------
CREATE TYPE account_type   AS ENUM ('admin','customer');
CREATE TYPE account_status AS ENUM ('active','disabled');
CREATE TYPE user_role      AS ENUM ('admin','customer');

CREATE TABLE accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  type account_type NOT NULL,
  name text NOT NULL,
  parent_id uuid REFERENCES accounts(id),
  status account_status NOT NULL DEFAULT 'active',
  plan text,
  locale text NOT NULL DEFAULT 'en',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES accounts(id),
  email citext UNIQUE NOT NULL,
  name text NOT NULL,
  role user_role NOT NULL,
  password_hash text NOT NULL,
  locale text,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- crops & growth stages --------------------------------------------------
CREATE TABLE crops (
  id text PRIMARY KEY,                 -- slug
  name_en text NOT NULL, name_ne text NOT NULL,
  emoji text NOT NULL, category text NOT NULL,
  days_to_harvest int NOT NULL,
  watering_notes_en text, watering_notes_ne text,
  ideal jsonb NOT NULL, acceptable jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE crop_stages (
  id text PRIMARY KEY,                 -- 'tomato:flowering'
  crop_id text NOT NULL REFERENCES crops(id),
  stage text NOT NULL, ordinal int NOT NULL, start_day int NOT NULL,
  ideal jsonb NOT NULL, acceptable jsonb NOT NULL,
  UNIQUE (crop_id, stage)
);

-- farms, gateways, nodes, zones, channels --------------------------------
CREATE TYPE compute_kind AS ENUM ('esp32','rpi4');
CREATE TYPE gw_status    AS ENUM ('online','offline','unbound');
CREATE TABLE farms (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES accounts(id),
  name text NOT NULL, timezone text NOT NULL DEFAULT 'Asia/Kathmandu',
  geo jsonb, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE gateways (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  serial text UNIQUE NOT NULL,
  farm_id uuid REFERENCES farms(id),
  account_id uuid REFERENCES accounts(id),
  compute compute_kind NOT NULL DEFAULT 'esp32',
  fw_version text NOT NULL DEFAULT '0.0.0',
  status gw_status NOT NULL DEFAULT 'unbound',
  last_seen timestamptz, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE nodes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  gateway_id uuid NOT NULL REFERENCES gateways(id),
  radio_addr text, battery int, last_seen timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE zones (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  farm_id uuid NOT NULL REFERENCES farms(id),
  name text NOT NULL,
  crop_id text REFERENCES crops(id),
  planting_date date,
  area_m2 numeric,
  node_id uuid REFERENCES nodes(id),
  mode text NOT NULL DEFAULT 'auto',   -- auto|manual
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TYPE channel_type AS ENUM
  ('moisture','ph','ec','n','p','k','soiltemp','airtemp','humidity','pressure','rain');
CREATE TABLE sensor_channels (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  zone_id uuid REFERENCES zones(id),
  farm_id uuid REFERENCES farms(id),
  type channel_type NOT NULL, unit text NOT NULL,
  calibration jsonb NOT NULL DEFAULT '{}', enabled boolean NOT NULL DEFAULT true
);
CREATE TABLE device_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  gateway_id uuid NOT NULL REFERENCES gateways(id),
  secret_hash text NOT NULL, revoked boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- rules, schedules, dosing, actuators ------------------------------------
CREATE TABLE rules (
  zone_id uuid PRIMARY KEY REFERENCES zones(id),
  moisture_low numeric NOT NULL, moisture_high numeric NOT NULL,
  rain_skip_mm numeric NOT NULL DEFAULT 4,
  ph_target numeric, ec_target numeric,
  source text NOT NULL DEFAULT 'crop',   -- crop|manual
  applied_stage text, updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE schedules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  farm_id uuid NOT NULL REFERENCES farms(id),
  window_start_hour int NOT NULL DEFAULT 5, window_end_hour int NOT NULL DEFAULT 19,
  et0_aware boolean NOT NULL DEFAULT true, max_run_min int NOT NULL DEFAULT 90,
  enabled boolean NOT NULL DEFAULT true
);
CREATE TABLE dosing_profiles (
  farm_id uuid PRIMARY KEY REFERENCES farms(id),
  ec_target numeric NOT NULL, ph_target numeric NOT NULL,
  pumps jsonb NOT NULL DEFAULT '[]'
);
CREATE TYPE actuator_scope AS ENUM ('zone','farm');
CREATE TYPE actuator_type  AS ENUM ('valve','pump','dosing');
CREATE TABLE actuators (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scope actuator_scope NOT NULL,
  zone_id uuid REFERENCES zones(id), farm_id uuid REFERENCES farms(id),
  type actuator_type NOT NULL,
  state boolean NOT NULL DEFAULT false, desired boolean, mode text NOT NULL DEFAULT 'auto'
);

-- telemetry + usage (Timescale) ------------------------------------------
CREATE TABLE telemetry (
  time timestamptz NOT NULL, channel_id uuid NOT NULL REFERENCES sensor_channels(id),
  zone_id uuid, farm_id uuid, value double precision NOT NULL, quality smallint NOT NULL DEFAULT 1
);
SELECT create_hypertable('telemetry','time', chunk_time_interval => INTERVAL '1 day', if_not_exists => TRUE);
CREATE INDEX IF NOT EXISTS telemetry_channel_time ON telemetry (channel_id, time DESC);
CREATE INDEX IF NOT EXISTS telemetry_zone_time ON telemetry (zone_id, time DESC);
CREATE TABLE usage_events (
  time timestamptz NOT NULL, farm_id uuid NOT NULL, zone_id uuid,
  kind text NOT NULL, value double precision NOT NULL
);
SELECT create_hypertable('usage_events','time', chunk_time_interval => INTERVAL '1 day', if_not_exists => TRUE);
-- continuous aggregates: create WITH NO DATA, then add refresh policies.
-- telemetry_5m / telemetry_1h / telemetry_1d (avg/min/max by bucket, channel_id, zone_id)
-- usage_1d (sum by bucket, farm_id, zone_id, kind)
-- 90-day retention on telemetry; compression after 7 days.

-- alerts, harvest, audit, entitlements, catalog --------------------------
CREATE TYPE alert_sev AS ENUM ('info','warn','critical');
CREATE TABLE alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES accounts(id),
  farm_id uuid REFERENCES farms(id), zone_id uuid REFERENCES zones(id),
  severity alert_sev NOT NULL, type text NOT NULL,
  message_en text NOT NULL, message_ne text,
  ts timestamptz NOT NULL DEFAULT now(), acknowledged_at timestamptz
);
CREATE TABLE harvest_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  zone_id uuid NOT NULL REFERENCES zones(id),
  crop_id text NOT NULL REFERENCES crops(id),
  harvested_at date NOT NULL, yield_kg numeric, notes text
);
CREATE TABLE audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id uuid NOT NULL REFERENCES users(id), account_id uuid,
  action text NOT NULL, target text, before jsonb, after jsonb,
  ts timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE device_catalog (
  key text PRIMARY KEY, label text NOT NULL, category text NOT NULL,
  kind text NOT NULL, default_value jsonb NOT NULL, hint text, gates_dashboard boolean NOT NULL DEFAULT false
);
CREATE TABLE entitlement_records (
  account_id uuid PRIMARY KEY REFERENCES accounts(id),
  values jsonb NOT NULL, updated_by uuid REFERENCES users(id),
  updated_at timestamptz NOT NULL DEFAULT now()
);
```

**Device catalog seed (9 modules):** `zoneNodes`(count,default 3), `mainPump`(toggle,true),
`fertigation`(toggle,true), `weatherMast`(toggle,true), `reservoirMonitoring`(toggle,false),
`flowMeter`(toggle,false), `otaManaged`(toggle,true), `mobileApp`(toggle,true),
`analytics`(toggle,false). Categories: sensing/actuation/platform.

**Seed for parity:** 1 admin root + admin user (`admin@teranode.io`), 1 customer
(`Green Valley Farm`) + customer user (`farmer@greenvalley.np`), 1 farm + 1 esp32 gateway
(`TN-ESP32-0001`, online), 3 zones: Zone 1 = tomato (planting_date ~65d ago → fruiting),
Zone 2 = capsicum (~45d → flowering), Zone 3 = spinach (~12d → vegetative); sensor_channels for
each zone (moisture/ph/ec/n/p/k/soiltemp) + farm weather channels; rules derived from each crop's
current-stage band; entitlement_records for the customer; all 14 crops + their stages.
Login is password-based; seed both users with bcrypt hash of password `teranode`.

---

## 3. Crop library (`packages/agronomy/src/crops/`)

```ts
export type CropCategory = 'fruiting'|'leafy'|'root'|'bulb'|'legume'|'brassica';
export type GrowthStage  = 'germination'|'vegetative'|'flowering'|'fruiting'|'harvest';
export type Channel = 'moisture'|'ph'|'ec'|'n'|'p'|'k'|'soilTemp'|'airTemp';
export type Range = [number, number];                 // [low, high] inclusive
export interface CropBand { moisture:Range; ph:Range; ec:Range; n:Range; p:Range; k:Range; soilTemp:Range; airTemp:Range; }
export interface CropStageDef { stage:GrowthStage; ordinal:number; startDay:number; ideal:CropBand; acceptable:CropBand; }
export interface Crop {
  id:string; nameEn:string; nameNe:string; emoji:string; category:CropCategory;
  daysToHarvest:number; wateringNotesEn:string; wateringNotesNe:string;
  ideal:CropBand; acceptable:CropBand; stages:CropStageDef[];
}
```

Units: moisture %, pH unitless, EC mS/cm, N/P/K mg/kg, soil/air temp °C. Build all 14 crops with
a full `stages[]` (germination→vegetative→flowering→fruiting→harvest where applicable; leafy/root
crops may skip flowering/fruiting). `acceptable` is a wider band than `ideal` (≈ ±20–30%).
Derive each stage's bands from the whole-crop ideal using the 4 fully-specified patterns below.

**Fully specified patterns (use as templates):**
- **tomato** 🍅 fruiting, 110d. ideal: moisture 60–75, pH 6.0–6.8, EC 2.0–3.5, N 100–150, P 40–60, K 150–250, soilTemp 18–26, airTemp 20–28. stages: germination(d0) moisture 65–80,EC 1.0–1.5,N 60–90; vegetative(d21) moisture 60–75,EC 1.8–2.5,N 120–150,K 120–180; flowering(d45) moisture 60–70,EC 2.2–3.0,P 50–70,K 180–220; fruiting(d65) moisture 65–75,EC 2.5–3.5,N 100–130,K 200–280; harvest(d95) moisture 55–70,EC 2.0–3.0.
- **capsicum** 🫑 fruiting, 100d. ideal: moisture 55–70, pH 6.0–6.8, EC 1.8–3.0, N 110–160, P 40–60, K 150–220, soilTemp 18–26, airTemp 20–28. stages: germination(d0) moisture 65–80,EC 1.0–1.4; vegetative(d20) N 130–160,EC 1.8–2.4; flowering(d45) P 50–65,K 160–200,EC 2.0–2.6; fruiting(d60) K 180–240,EC 2.4–3.0; harvest(d85) EC 1.8–2.6.
- **spinach** 🥬 leafy, 45d. ideal: moisture 65–80, pH 6.0–7.0, EC 1.2–2.0, N 120–180, P 40–55, K 140–200, soilTemp 10–22, airTemp 12–24. stages: germination(d0) moisture 70–85,EC 0.8–1.2; vegetative(d12) N 150–180,EC 1.4–1.8; harvest(d35) N 120–150,moisture 65–78.
- **cucumber** 🥒 fruiting/vine, 60d. ideal: moisture 65–80, pH 5.8–6.8, EC 1.8–2.8, N 120–170, P 40–60, K 160–230, soilTemp 18–28, airTemp 22–30. stages: germination(d0) moisture 70–85,EC 1.0–1.4; vegetative(d15) N 150–170,EC 1.8–2.2; flowering(d30) P 50–65,K 170–210; fruiting(d40) K 190–250,moisture 70–82,EC 2.2–2.8.

**Remaining 10 (whole-crop ideal; build plausible stages):**

| id | nameEn / nameNe | emoji | cat | d2h | moisture | pH | EC | N | P | K | soilTemp | airTemp |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| chili | Chili / खुर्सानी | 🌶️ | fruiting | 95 | 55–70 | 6.0–6.8 | 1.8–2.8 | 100–150 | 40–55 | 150–220 | 18–28 | 20–30 |
| lettuce | Lettuce / सलाद | 🥗 | leafy | 50 | 65–80 | 6.0–7.0 | 1.2–1.8 | 100–150 | 35–50 | 130–180 | 10–20 | 12–22 |
| cabbage | Cabbage / बन्दा | 🥬 | brassica | 75 | 60–75 | 6.0–7.0 | 1.5–2.5 | 120–180 | 40–60 | 150–220 | 12–22 | 15–25 |
| cauliflower | Cauliflower / काउली | 🥦 | brassica | 80 | 60–75 | 6.0–7.0 | 1.5–2.5 | 130–190 | 45–65 | 160–230 | 12–22 | 15–24 |
| onion | Onion / प्याज | 🧅 | bulb | 120 | 50–65 | 6.0–7.0 | 1.2–2.0 | 80–130 | 40–60 | 150–220 | 13–24 | 15–25 |
| carrot | Carrot / गाजर | 🥕 | root | 80 | 55–70 | 6.0–6.8 | 1.0–2.0 | 70–110 | 45–65 | 170–250 | 10–22 | 15–24 |
| potato | Potato / आलु | 🥔 | root | 100 | 60–75 | 5.0–6.5 | 1.5–2.5 | 110–160 | 50–70 | 200–300 | 12–22 | 15–24 |
| eggplant | Brinjal / भान्टा | 🍆 | fruiting | 100 | 60–75 | 6.0–6.8 | 2.0–3.0 | 110–160 | 40–60 | 160–230 | 18–28 | 22–30 |
| okra | Okra / भिन्डी | 🌿 | fruiting | 60 | 55–70 | 6.0–6.8 | 1.5–2.5 | 90–140 | 35–55 | 140–200 | 20–30 | 24–32 |
| beans | Beans / सिमी | 🫘 | legume | 60 | 55–70 | 6.0–7.0 | 1.0–1.8 | 40–80 | 40–60 | 120–180 | 16–26 | 18–28 |

Crop values are advisory (literature-typical), editable as one row.

---

## 4. Agronomy engine (`packages/agronomy/src/engine/`) — pure, unit-tested

```ts
currentStage(crop, plantingDate, now?) -> { stage, def, daysSincePlanting, daysToHarvest }
type BandStatus = 'below'|'in'|'above'|'unknown';
interface ChannelStatus { channel; value; status; idealRange; acceptableRange; deviation; }
evaluateChannels(band: CropBand, readings: Partial<Record<Channel,number>>) -> ChannelStatus[]
interface HealthResult { score:number; perChannel:ChannelStatus[]; }
zoneHealth(band, readings) -> HealthResult
interface Recommendation { channel; severity:'info'|'warn'|'critical'; messageEn; messageNe; action; }
  // action ∈ increase_dosing|decrease_dosing|irrigate|hold_water|ph_up|ph_down|wait
recommendations(crop, stage, statuses, locale?) -> Recommendation[]
deriveRule(crop, stage) -> { moistureLow; moistureHigh; phTarget; ecTarget }
analyzeZone({crop, plantingDate, readings, now?, locale?}) ->
  { stage, daysSincePlanting, health, channels, recommendations, rule }
```

**Health formula:** per channel: in-band → 1.0; within acceptable but outside ideal → linear
1.0→0.5 across the gap; outside acceptable → 0.5→0.0 decaying over one ideal-width beyond the
acceptable edge (floor 0). Weighted mean — moisture .30, pH .15, EC .15, N/P/K .10 each,
soilTemp .05, airTemp .05; renormalize over channels actually present.
`score = round(100 * Σ wᵢsᵢ / Σ wᵢ)`.
**Recommendation examples:** `n.below & stage∈{vegetative,fruiting}` → increase_dosing
("N is {v} mg/kg vs {lo}–{hi} target for {stage} — increase nutrient dosing.");
`ph.above` → ph_down; `moisture.below` → irrigate; `moisture.above` → hold_water;
`ec.above` → decrease_dosing. Emit both `messageEn` and `messageNe`.
Engine must be pure/deterministic and covered by vitest tests (`*.test.ts`).

---

## 5. API surface (`apps/api`, 2-role)

JWT access (~15m) + rotating refresh in Redis; JWT carries `userId, accountId, accountType, role`.
Middleware: `requireAuth`, `requireAdmin`, `scopeToCustomer` (customer → own account; admin → all).

```
POST /auth/login  /auth/refresh  /auth/logout      GET /me   GET /me/entitlements
# admin
GET/POST /admin/customers   GET/PATCH /admin/customers/:id   PATCH /admin/customers/:id/entitlements
GET /admin/fleet   POST /admin/gateways   POST /admin/gateways/:id/bind   POST /admin/gateways/:id/ota
GET /admin/audit   GET /device-catalog
# crops (GET any authed; POST/PATCH admin)
GET /crops   GET /crops/:id   POST /crops   PATCH /crops/:id   PATCH /crops/:id/stages
# customer-scoped
GET/POST /farms   GET/PATCH/DELETE /farms/:id
GET /farms/:id/zones   POST /zones   PATCH/DELETE /zones/:id
POST /zones/:id/assign        # body {cropId, plantingDate, nodeId?, channels[]} → auto-applies crop rule
GET  /zones/:id/analysis      # agronomy: stage, health, channels, recommendations
GET  /zones/:id/telemetry?from&to&agg=raw|5m|1h|1d
GET/PUT /zones/:id/rules      GET /farms/:id/schedules  PUT /schedules/:id  GET/PUT /farms/:id/dosing-profile
POST /actuators/:id/command   # {action: open|close|on|off|dose} desired-vs-reported
GET /alerts   POST /alerts/:id/ack   GET/POST /harvest
# analytics
GET /analytics/usage?farmId&from&to&agg   GET /analytics/savings?farmId&from&to   GET /analytics/export?farmId&from&to&format=csv
# realtime
WS /live?token=JWT   → {subscribe: farmId|zoneId}   (Redis pub/sub fan-out)
```

MQTT topics (ingest): `teranode/{accountId}/{farmId}/{gatewayId}/telemetry/zone/{zoneId}` (+ weather,
health, state, cmd). Ingest validates → writes `telemetry`/`usage_events`, updates `actuators.state`,
publishes to Redis → WS fan-out. The **virtual gateway** replays the legacy `driftZones` hysteresis
(open valve when moisture<low, close when >high; pump on if any valve open; jitter ph/ec/soilTemp;
emit usage liters while a valve is open) over MQTT so the stack runs hardware-free.

---

## 6. Client method seam (mobile)

`apps/mobile/src/api/client.ts` exposes `api.*` with a `USE_MOCK` flag → `apps/mobile/src/api/mock.ts`.
Keep the method→endpoint map 1:1 so the cutover is a flag flip. Mobile stays on mock until Phase 6.
New methods needed: `crops()`, `zoneAnalysis(zoneId)`, `assignZone(...)`, `analytics*`, `harvest*`,
`login(email,password)`. The mock must reuse `@teranode/agronomy` for `analyzeZone` so health/recs
match the server exactly.

---

## 7. Client screens

**Web admin (`apps/web`, role=admin):** Login · Customers (list + create wizard with device-catalog
module toggles, freely editable; customer detail with entitlement editor) · Fleet (gateway list,
online/offline/LWT, battery/fw/last-seen; register serial→token; bind→farm; OTA view) · Crops admin
(library table + add/edit crop & stages) · Audit log · (optional) cross-tenant analytics.
Port the parchment palette to CSS variables; i18n en/ne.

**Mobile customer (`apps/mobile`, role=customer):** route group `(customer)` (the old `(company)`/
`(retailer)` groups are deleted, `(farmer)`→`(customer)`):
- **Field/dashboard** — zone tiles + systems + weather + per-zone **Health ring** + crop emoji/stage badge.
- **Zone detail** — gauges/bars + valve auto/manual control (desired-vs-reported pending), **stage-aware
  target ticks**, per-channel below/in/above pills, **Coach card** (top recommendation, en/ne).
- **Add/assign zone** — crop picker (search + category filter + climate-fit hint) → planting date →
  bind ESP32 node + sensor channels → auto-apply crop rules.
- **Analytics** — water/fertilizer usage trends, savings vs baseline, harvest/yield log + CSV share.
- **History** — sparklines from rollups. **Alerts** — localized + push-ready. **Account** — language
  toggle (en/ne) + **Field mode** (large-touch) toggle.
- Cross-cutting: `src/i18n/` (en+ne), offline-first cached overview/analysis in AsyncStorage,
  field-mode theme scale.

---

## 8. Build phases & file-ownership map (disjoint within a phase)

- **P1 (sequential):** 1.1 `packages/types/src/**` → then 1.2 `packages/agronomy/src/**` (imports types).
- **P2:** parallel[ 2.1 `infra/**` ; 2.2 `apps/api/src/db/**` + `infra/migrations/**` + drizzle config ]
  → 2.3 `apps/api/src/index.ts` + `apps/api/src/middleware/**` + `routes/auth.ts` + `lib/**` +
  `ws/index.ts`(stub) + creates STUB routers `routes/{admin,farms,zones,actuators,rules,alerts,harvest,crops,analytics}.ts`
  and mounts all in index.ts; deletes legacy `store.ts`,`types.ts`,`routes/{retailer,company,farms,zones,actuators,alerts}.ts` if present.
- **P3 (parallel, each owns one route + its service file under `apps/api/src/services/`):**
  3.1 admin/customers/entitlements/audit · 3.2 farms/zones/assign/analysis · 3.3 actuators/rules/schedules/dosing
  · 3.4 alerts/harvest · 3.5 crops · 3.6 analytics/export. `index.ts` frozen.
- **P4 (parallel):** 4.1 `apps/ingest/src/{index,handlers,db}.ts` · 4.2 `apps/ingest/src/virtual/**` ·
  4.3 `apps/api/src/ws/**` + `apps/api/src/lib/mqttPublish.ts` (new files only; index.ts already calls ws stub).
- **P5 web (after solo 5.W0 scaffold `apps/web/{vite.config.ts,index.html,src/main,src/App,src/router,src/api/client,src/i18n/**,src/theme/**}`):**
  5.W1 `src/pages/customers/**` · 5.W2 `src/pages/fleet/**` · 5.W3 `src/pages/crops/**` · 5.W4 `src/pages/{audit,analytics}/**`.
- **P5 mobile (after solo 5.M0: delete `(company)`/`(retailer)`, rename `(farmer)`→`(customer)`,
  fix `app/_layout.tsx`,`app/index.tsx`,`src/auth/AuthContext.tsx`):**
  5.M1 `src/i18n/**`+`src/theme/scale.ts`+`src/components/ui.tsx` · 5.M2 `app/(customer)/dashboard.tsx`,
  `app/(customer)/zones/[zoneId].tsx`,`src/components/FieldTiles.tsx`,`src/components/HealthRing.tsx` ·
  5.M3 `app/(customer)/zones/new.tsx`,`src/components/CropPicker.tsx` · 5.M4 `app/(customer)/analytics.tsx`,
  `app/(customer)/alerts.tsx`,`app/(customer)/history.tsx`,`app/(customer)/account.tsx`,`src/components/Charts.tsx` ·
  5.M5 (solo) `src/api/mock.ts`+`src/api/client.ts`.
- **P6 (sequential):** flip `apps/mobile/app.json` extra.useMockApi→false; point web+mobile at api; e2e.

---

## 9. Verification gates (per phase)
- P1: `npm run -w @teranode/agronomy test` + typecheck both packages.
- P2: `docker compose -f infra/docker-compose.yml up -d` (allow long image pulls) → wait DB healthy →
  `npm run -w @teranode/api migrate` → `seed` → boot api (tsx) → `POST /auth/login` admin + customer return JWT.
- P3: boot api against live DB → curl each route with proper JWT → fix 500s → api typecheck.
- P4: run ingest virtual gateway → telemetry rows land in DB → `GET /zones/:id/telemetry?agg=5m` returns
  rows (refresh CAGG if needed) → WS client receives a live message.
- P5: `npm run -w @teranode/web build` (vite) + `cd apps/mobile && npx expo export --platform web`.
- P6: full stack up + virtual gateway + both clients exercised end-to-end.
