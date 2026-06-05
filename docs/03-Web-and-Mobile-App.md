# 03 · Web & Mobile App

> The software product: the **React** web app (company master dashboard **+** customer admin panel), the **React Native** mobile app, the **Express** backend, **PostgreSQL/TimescaleDB**, auth/RBAC, and the provisioning flow.
> Related: [Architecture](./01-System-Architecture.md) · [IoT & Firmware](./02-IoT-Hardware-and-Firmware.md)

---

## 1. Stack (confirmed)

| Layer | Tech | Notes |
|---|---|---|
| Web frontend | **React** (Vite + TypeScript) | One app, two role-gated surfaces (master + customer) |
| Mobile | **React Native** (Expo + TypeScript) | iOS + Android; shares types/SDK with web |
| Backend | **Express** (Node.js + TypeScript) | REST + WebSocket; MQTT bridge |
| Database | **PostgreSQL + TimescaleDB** | Relational + time-series in one DB (`01 §5`) |
| Realtime/cache | **Redis** | WebSocket fan-out (pub/sub), sessions, rate-limit |
| Broker | **Mosquitto (MQTT)** | Device link only (`01 §4`) |
| Infra | **Docker Compose on a VPS**, Nginx + Let's Encrypt | `01 §8` |

**Shared package:** a `@teranode/types` (or OpenAPI-generated client) so web, mobile, and backend share request/response and entity types — fewer drift bugs.

---

## 2. The two web surfaces

### 2.1 Company Master Dashboard (super-admin)
The control room for the TERANODE company.
- **Customer/org management:** create org, add the org-admin user (manual provisioning), enable/disable, set plan.
- **Device binding:** register a gateway by **serial**, issue its **device token**, assign to an org/farm.
- **Fleet health:** map/list of all gateways — online/offline (from MQTT LWT), battery, last-seen, firmware version, open alerts.
- **OTA:** push/stage firmware to selected gateways; watch rollout + rollback.
- **Support:** scoped impersonation / "view as" a customer (audited), inspect a farm's live + historical data to help debug.
- **Audit log:** every privileged action.

### 2.2 Customer Admin Panel (org-admin / operator / viewer)
The "powerful, detailed dashboard with all info and switches" the customer gets after setup.
- **Farm designer:** create farms; **draw/define zones** (name, area, crop); assign each zone's node + valve; lay out the weather mast. (Map/drag canvas; manual coordinates fallback.)
- **Live overview:** per-zone tiles/gauges — soil moisture, pH, N-P-K, EC, soil temp; farm weather (air temp, humidity, pressure, rain); water level; pump & dosing status. Mirrors the reference app's gauge style.
- **Controls/switches:** per-zone valve **Auto/Manual + ON/OFF**; main pump; dosing pumps; with confirm + desired-vs-reported state (`01 §4`).
- **Rules & schedules:** per-zone moisture low/high thresholds, rain-skip mm, allowed watering windows; dosing EC/pH targets + safety caps.
- **History & charts:** time-series per channel (live raw + rollups), CSV export, compare zones.
- **Alerts:** offline gateway, sensor fault, valve-open-no-flow, low battery, out-of-range readings; acknowledge + history.
- **Account:** org users & roles; profile; (billing placeholder for later).

### 2.3 On-site touchscreen (optional, Phase 2)
The reference build had a wall touchscreen. Optional local HMI = the React app in kiosk mode on a small panel at the farm, working on LAN without internet. Serving a full React kiosk needs the **optional Raspberry Pi gateway** (the ESP32 brain can't host it); a lightweight alternative on an ESP32-only farm is a small attached display (e.g. an ESP32 board with a built-in TFT/touch) showing key readings + switches, or a tablet running the normal app on the LAN.

---

## 3. Mobile app (React Native)
Customer-facing, optimized for "check + tap" in the field:
- Farm/zone live overview (tiles + simple charts).
- Valve/pump/dosing switches with confirmation.
- **Push notifications** for alerts (Expo push / FCM/APNs).
- Acknowledge alerts; recent history.
- Login + biometric unlock; works on flaky mobile networks (cached last state, optimistic UI with server confirmation).

> Master/super-admin functions stay web-only for the MVP (richer screens, less frequent use).

---

## 4. Backend (Express)

### 4.1 Responsibilities
- REST API (CRUD: orgs, users, farms, zones, devices, rules, schedules, dosing profiles, alerts).
- **WebSocket** channels for live telemetry + state to web/mobile.
- **MQTT bridge:** the ingest worker subscribes to telemetry/state/health → validates → writes to Postgres/TimescaleDB → publishes to Redis → WebSocket fan-out. Command endpoints publish to `cmd/...` and wait for the device's reported `state/...`.
- Auth (JWT + refresh), RBAC, tenant scoping, audit logging.
- Alerts engine (rule evaluation on incoming telemetry + offline detection from LWT).

### 4.2 Suggested API surface (REST)
```
POST   /auth/login                 /auth/refresh   /auth/logout
# super-admin
POST   /admin/orgs                 GET /admin/orgs
POST   /admin/orgs/:id/users
POST   /admin/gateways             # register serial → issue device token
POST   /admin/gateways/:id/bind    # assign to org/farm
GET    /admin/fleet                # health overview
POST   /admin/gateways/:id/ota
# tenant-scoped (org from JWT)
GET    /farms        POST /farms        GET/PATCH/DELETE /farms/:id
GET    /farms/:id/zones   POST /zones   PATCH/DELETE /zones/:id
GET    /zones/:id/telemetry?from&to&agg=raw|5m|1h|1d
GET    /zones/:id/rules   PUT /zones/:id/rules
GET    /farms/:id/schedules  PUT /schedules/:id
PUT    /farms/:id/dosing-profile
POST   /actuators/:id/command      # {action: open|close|on|off|dose, ttl?}
GET    /alerts   POST /alerts/:id/ack
GET    /me   GET /orgs/:id/users   POST /orgs/:id/users
```

### 4.3 WebSocket
```
client subscribes:  ws://…/live?token=JWT  → {subscribe: farmId|zoneId}
server pushes:      telemetry updates, actuator state changes, new alerts
backed by Redis pub/sub so multiple API instances fan out consistently
```

### 4.4 Why Express here
Chosen by the team; pairs naturally with React/React Native (one language across web, mobile, API). Node's event model fits many concurrent WebSocket/MQTT subscribers. (The gateway runs **C/C++ firmware on the ESP32** — or Python on the optional RPi — see `02 §9`; it talks to the cloud only via MQTT, so the device and backend languages don't need to match.)

---

## 5. Data layer
- **PostgreSQL** for the relational core (`01 §5`).
- **TimescaleDB** hypertable for `telemetry`; **continuous aggregates** for 5-min/hourly/daily rollups; **compression** on old chunks; ~90-day raw retention. Charts query rollups for long ranges, raw for live.
- **Redis** for WebSocket pub/sub, session/refresh-token store, and rate limiting.
- Migrations via a tool like `node-pg-migrate`/Prisma/Drizzle (pick one; keep schema in version control).

---

## 6. Auth, RBAC & multi-tenancy
- **JWT** access (short-lived) + refresh (rotating, stored in Redis); HTTPS only.
- Roles: `super_admin`, `org_admin`, `operator`, `viewer` (`01 §2`).
- **Tenant scoping middleware:** derive `organization_id` from the JWT; every tenant query filtered by it; super-admin routes are a separate, audited surface. Optional **Postgres RLS** as defense-in-depth before scaling tenants.
- **Device identity:** gateways authenticate to MQTT with a unique token + ACL (`01 §7`), issued during binding.
- Audit log for all privileged/control actions.

---

## 7. Provisioning flow (manual, MVP)
```
1. Sale happens offline.
2. Super-admin creates the Organization + org-admin user (email) in the master dashboard.
3. Super-admin registers the gateway by serial → system issues a device token + MQTT ACL.
4. Field tech flashes/configures the gateway with that token (06 §4) and installs hardware.
5. Customer receives a welcome email, logs in, and uses the Farm Designer to define
   zones and bind each zone's node + valve.
6. Telemetry starts flowing; dashboards light up.
```
The org/user/device model is built so **automated** purchase→account→provision (payments via Stripe/eSewa/Khalti) can be layered on later without reworking the schema — a documented future hook only.

---

## 8. UI/UX notes (from the reference photos)
- Reference app showed circular **gauges** (pH, EC, TDS, temp, water level) + **ON/OFF pump toggles**; the wall panel had **Home / Graph / Settings / Alerts** tabs. TERANODE adopts that vocabulary: tile/gauge live view, dedicated Graph (history), Settings (rules/schedules/dosing), Alerts.
- Add the **zone** dimension the reference lacked: a zone switcher / farm map so a customer can drill from farm → zone → channel.
- Clear **Auto vs Manual** affordance per actuator; show *reported* device state, and a pending indicator while a command is in flight.
- Branding/theming centralized (design tokens) so the company can white-label later.

---

## 9. Repository structure (monorepo)
```
teranode/
  apps/
    web/            # React (Vite) — master + customer surfaces, role-gated routes
    mobile/         # React Native (Expo)
    api/            # Express REST + WebSocket
    ingest/         # MQTT → DB/Redis worker (can live in api/ for MVP)
  packages/
    types/          # shared TS types / API client
    ui/             # shared web components (optional)
  infra/
    docker-compose.yml   # nginx, api, ingest, mosquitto, postgres(timescale), redis
    nginx/ , mosquitto/ , migrations/
  .env.example
```

## 10. CI/CD (outline)
- Lint + typecheck + unit tests on PR.
- Build Docker images; deploy to the VPS via SSH/`docker compose pull && up -d` (or a small GH Action).
- DB migrations run on deploy; nightly off-host Postgres backups; staging mirrors prod (`01 §8`).
- Mobile: Expo EAS build channels (dev/preview/prod).

## 11. MVP build order (software)
1. DB schema + migrations + seed (one demo org/farm/zones).
2. Auth + RBAC + tenant scoping.
3. **Virtual gateway** script publishing fake MQTT telemetry → ingest worker → DB → WebSocket. (Lets the UI be built before hardware is ready.)
4. Customer admin: live overview + history + actuator commands + rules.
5. Master dashboard: org/user creation, gateway binding/token issuance, fleet health.
6. Alerts engine + notifications (email, push).
7. React Native app (overview + controls + push).
8. Swap the virtual gateway for the real one (`02 §11`); end-to-end field test.
