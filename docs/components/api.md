# API (Express REST + WebSocket)

The cloud backend: a TypeScript Express server (run via `tsx`) exposing a REST surface, a `/live`
WebSocket, and the device‑facing `POST /provision`. It is the only writer of the system of record
and the only publisher of MQTT commands.

Source: `apps/api/src/`. Entry point `index.ts` (frozen; feature handlers live in their own files).
Endpoint reference: {doc}`../reference/rest-api`.

## 1. Directory structure

```
apps/api/src/
├── index.ts            Express app + http server + /live WS + route mounts
├── routes/             12 routers (thin: parse → authorize → service → shape)
│   ├── auth.ts         login / refresh / logout / me / me/entitlements
│   ├── admin.ts        customers, entitlements, fleet, claim, OTA, audit, delete
│   ├── farms.ts        farms + /farms/:id/{zones,gateway,actuators,readings}
│   ├── zones.ts        zone CRUD, assign-crop, analysis, telemetry, valve
│   ├── actuators.ts    actuator command (desired-vs-reported)
│   ├── rules.ts        per-zone irrigation rule
│   ├── alerts.ts       list / acknowledge
│   ├── harvest.ts      harvest log
│   ├── crops.ts        crop library (read; admin write)
│   ├── analytics.ts    usage / savings / export
│   ├── deviceCatalog.ts catalog + entitlement edit
│   └── provision.ts    device-facing { serial, secret } (no JWT)
├── services/           business logic + all DB access (Drizzle)
│   ├── customers.ts    accounts, owner users, fleet, register/claim/delete, gateway lookup
│   ├── farms.ts        farm/zone read, getFarmGateway, getFarmReadings
│   ├── zones.ts        createZone (zoneNodes cap), assignZone, analysis, telemetry
│   ├── control.ts      actuators, zone-valve command, rules, schedules, dosing
│   ├── crops.ts · alerts.ts · analytics.ts · entitlements.ts · audit.ts · provisioning.ts
├── middleware/         auth (requireAuth/requireAdmin/scopeToCustomer), entitlements, error
├── db/                 client (pg Pool + Drizzle), schema.ts, migrate.ts, seed.ts
├── lib/                jwt, authCookies (refresh cookie + CSRF), redis, email, mqttPublish
└── ws/                 /live WebSocket (Redis live bus → per-account fan-out)
```

## 2. Request lifecycle

```{mermaid}
flowchart LR
  REQ["HTTP request"] --> CORS["cors (credentials)"] --> JSON["express.json"]
  JSON --> RT["router match"]
  RT --> MW["requireAuth → requireAdmin? → scopeToCustomer"]
  MW --> H["route handler (zod parse)"]
  H --> SVC["service (Drizzle / pg)"]
  SVC --> DB[("Postgres")]
  H --> SHAPE["shape DTO (@teranode/types)"]
  SHAPE --> RES["res.json"]
  H -. "throws HttpError" .-> ERR["errorHandler → JSON error"]
```

Routers stay thin: **parse → authorize → call a service → shape the DTO**. All DB access is in the
services; all error handling funnels through `HttpError` + the error middleware. Wire shapes come
from `@teranode/types` so the client and server can't drift.

## 3. The route surface (mounted in `index.ts`)

```{list-table}
:header-rows: 1
:widths: 22 16 62

* - Mount
  - Audience
  - Purpose
* - `/auth`, `/me`
  - public / authed
  - login, refresh (cookie+CSRF), logout, current user + entitlements
* - `/admin/*`
  - admin
  - customers + entitlements, fleet, claim device, OTA, audit, delete customer/device
* - `/farms`, `/zones`
  - customer/admin
  - farms, zones, gateway, latest readings, crop assignment, analysis, telemetry, valve
* - `/actuators`, `/rules`
  - customer/admin
  - actuator commands; per‑zone irrigation rule
* - `/alerts`, `/harvest`
  - customer/admin
  - alerts list/ack; harvest log
* - `/crops`
  - read; admin write
  - crop library (bands + stages, fertilizer schedule source)
* - `/analytics`
  - entitlement‑gated
  - usage, savings, CSV export
* - `/device-catalog`
  - admin
  - catalog + per‑account entitlement editing
* - `/provision`
  - device
  - serial+secret provisioning (no JWT)
```

Full per‑endpoint detail (verbs, scoping, bodies): {doc}`../reference/rest-api`.

## 4. Real‑time: the `/live` WebSocket

The ingest worker publishes every reading/state change to **Redis**; the API's `/live` WS
(`src/ws/`) subscribes and **fans out** to each connected client, filtered to the farms of that
client's account. This is how the web dashboards and the mobile field view update within seconds
without polling. See {doc}`../architecture/data-flow`.

## 5. Auth, scoping, entitlements

Covered in depth in {doc}`../architecture/security`:

- **JWT** access (15 m) + refresh (30 d, Redis‑tracked, single‑use rotation); web uses an httpOnly
  refresh cookie + CSRF; mobile uses secure‑store.
- **Scoping** — `scopeToCustomer` hard‑scopes customers to their `accountId`; admins may target any
  account; services walk `zone → farm → account` for ownership.
- **Entitlements** — `requireEntitlement(key)` (403 when off); `zoneNodes` caps zone creation.

## 6. Outbound integrations

```{list-table}
:header-rows: 1
:widths: 26 74

* - Integration
  - Where
* - MQTT command publish
  - `lib/mqttPublish` — actuator/zone commands published (retained) to the device's topic.
* - Redis live bus + token store
  - `lib/redis` — subscribe for `/live`; store/rotate/revoke refresh tokens.
* - Email (SMTP)
  - `lib/email` — welcome email on customer creation (Mailpit in dev).
```

## 7. Run

```bash
npm run -w @teranode/api migrate && npm run -w @teranode/api seed
npm run -w @teranode/api dev        # tsx watch, http://localhost:4000 (ws: /live)
# health: GET http://localhost:4000/healthz
```
