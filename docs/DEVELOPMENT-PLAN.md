# TERANODE — Development Plan (App · Web · Backend)

> Companion to the planning docs in the repo (`01`–`07`). Those docs describe the
> product and the field hardware. **This document is the software build contract**:
> it reconciles the new 3-tier account model the team specified, defines the data
> model and API surface that follow from it, and lays out the build order for the
> Express backend, the React web portals, and the React Native (Expo Dev Client)
> app that ships in this repo.
>
> Where this plan and docs `01`/`03` disagree, **this plan wins** — see
> [§10 What changed vs. the original docs](#10-what-changed-vs-the-original-docs).

---

## 1. Scope of this document

| Track | Status in this repo | Covered in |
|---|---|---|
| **Mobile app** (React Native + Expo Dev Client) | ✅ **Built** — runs against an in-app mock backend | this repo + §7 |
| **Backend** (Express + Node + Postgres/Timescale/Redis) | 📋 Specified, not yet coded | §3–§6 |
| **Web** (React company + retailer portals) | 📋 Specified, not yet coded | §8 |

The app is built **first and against a mock** so the UI, the role model, and the
entitlement guardrails are provable before any server exists. The mock implements
the exact same method surface the real API will expose (see `src/api/client.ts`),
so swapping `useMockApi: false` in `app.json` points every screen at Express with
no screen changes.

---

## 2. The account & access model (the core change)

The original docs (`01 §2`) used a flat tenancy: **Platform → Organization (tenant)
→ Farm → Zone**, with roles `super_admin / org_admin / operator / viewer`. The team
has since specified a **3-tier commercial hierarchy**:

```
TERANODE (the company)            ← us; one root account
   └── Retailer                   ← sells the product; created by the company
         └── Farmer (customer)    ← buys the product; created by a retailer
               └── Farm → Zone    ← the physical deployment (unchanged from docs)
```

- **The company** creates and manages **retailer** accounts (web).
- **Retailers** create and manage **farmer** accounts and sell hardware to them (web).
- **Farmers** are the end customers; they monitor and control their farm(s) from the
  **mobile app** (and a customer web panel later).

### 2.1 How this reconciles with the docs

Rather than throw away the docs' `organization` concept, we **generalize it into an
account tree**. Every account is a row in one `accounts` table with:

- `type` — `company | retailer | farmer`
- `parent_id` — self-referencing FK (`company.parent_id = NULL`, a retailer's parent
  is the company, a farmer's parent is their retailer)

The docs' `organization_id` data-isolation boundary (`01 §2`, `01 §7`) still exists —
it is simply **the farmer account**. A farmer *is* the tenant; their farms, zones,
gateways, telemetry, alerts, and users all carry their `account_id`. Retailers and
the company get scoped, audited access **up the tree** (a retailer sees its own
farmers; the company sees everything).

### 2.2 Roles

| Role | Lives on | Can do |
|---|---|---|
| `company_admin` | company account | Create/manage retailers; **edit any farmer's entitlements** (the only role that can); fleet health; OTA; bind gateways; impersonate for support (audited) |
| `retailer_admin` | retailer account | Create farmers; set each farmer's entitlements **at creation only**; manage its own farmers; cannot touch locked entitlements afterward |
| `farmer_admin` | farmer account | Full control of own farm(s): zones, rules, schedules, actuator overrides, manage farmer-side users |
| `farmer_operator` | farmer account | Monitor, acknowledge alerts, manual override (if permitted) |
| `farmer_viewer` | farmer account | Read-only |

This maps cleanly onto the docs' old roles: `super_admin` → `company_admin`,
`org_admin` → `farmer_admin`, and `operator`/`viewer` are unchanged but now scoped to
a farmer account. The new middle role is `retailer_admin`.

---

## 3. Modular devices = data-driven catalog + per-farmer entitlements

The team's requirement: under "IoT" there can be many device types (reservoir
monitoring, valve devices, weather, etc.); when a retailer creates a farmer they
**toggle these on/off**, and it must be **modular and dynamic — not hardcoded**.

We implement this as two pieces, both already present in the app and both intended to
live in the database for the backend:

### 3.1 Device catalog (`device_catalog` table / `src/entitlements/deviceCatalog.ts`)

A data-driven list of everything a farmer account can be entitled to. Each item:

```
key            unique slug, e.g. "reservoirMonitoring"
label          human label
category       sensing | actuation | platform
kind           toggle  (on/off)  |  count  (a number, e.g. how many zone nodes)
default        default value at the create-customer screen
hint           one-line description shown to the retailer
gatesDashboard whether turning this off hides a module in the farmer app
```

Current catalog: `zoneNodes` (count), `mainPump`, `fertigation`, `weatherMast`,
`reservoirMonitoring`, `flowMeter`, `otaManaged`, `mobileApp`, `analytics`. **Adding a
new device type = inserting one catalog row.** No app or API code changes — every
screen renders by iterating the catalog, never by naming a device.

### 3.2 Entitlements (`entitlement_records` table / `src/entitlements/entitlements.ts`)

One record per farmer account: a map of `catalog.key → boolean | number`, plus:

- `locked: boolean` — set `true` the moment the retailer creates the farmer
- `created_by`, `created_at`, `updated_by`, `updated_at` — audit trail

### 3.3 The create-time lock (the central guardrail)

> **A retailer chooses a farmer's entitlements once, at creation. After that the
> retailer can never edit them — only `company_admin` can.**

This is enforced in exactly one predicate, used by both the app and (to be) the API:

```ts
canEditEntitlements(role, record):
  company_admin  → always true
  retailer_admin → true only if record is NOT locked   (i.e. never, post-creation)
  otherwise      → false
```

- App: the farmer's Account screen shows entitlements **read-only with a 🔒 notice**;
  the retailer's customer list shows locked pills; only the create-customer screen can
  set them, and it locks on submit.
- API (spec): `POST /retailer/farmers` accepts an initial entitlements payload and
  writes `locked: true`. `PATCH /accounts/:id/entitlements` is **company-only** and
  rejects `retailer_admin` with `403` regardless of payload. The lock is server-side
  truth; the app UI is a convenience mirror of it.

---

## 4. Data model (deltas from `01 §5`)

Keep the entire relational core from `01 §5` (`farms`, `gateways`, `zones`, `devices`,
`sensor_channels`, `telemetry` hypertable, `actuators`, `rules`, `schedules`,
`dosing_profiles`, `alerts`, `audit_log`, `device_tokens`). Apply these changes:

**Replace `organizations` with `accounts`:**

```
accounts
  id            uuid pk
  type          enum(company, retailer, farmer)
  parent_id     uuid fk → accounts(id)   null only for the single company root
  name          text
  status        enum(active, disabled)
  plan          text            -- farmer billing tier (Basic/Pro/Enterprise, 07 §5)
  created_at, updated_at
  -- invariant: company.parent=NULL; retailer.parent=company; farmer.parent=retailer
```

**Re-scope every tenant-owned table** from `organization_id` to `account_id`, where
`account_id` always references a **farmer** account (the tenant boundary is unchanged
in meaning — `01 §7` data isolation still holds; we just renamed the owner).

**`users`** gains the new role enum and hangs off any account type:

```
users(id, account_id fk→accounts, email, role, password_hash, ...)
  role ∈ company_admin | retailer_admin | farmer_admin | farmer_operator | farmer_viewer
```

**New tables:**

```
device_catalog(key pk, label, category, kind, default_value jsonb, hint, gates_dashboard)
entitlement_records(
  account_id pk fk→accounts,         -- the farmer
  values jsonb,                      -- { catalogKey: bool|number }
  locked bool default true,
  created_by, created_at, updated_by, updated_at )
```

**Audit:** `audit_log` (already in docs) must record every entitlement write with
actor, target farmer, before/after values — this is the paper trail proving a retailer
never edited a locked record.

---

## 5. Backend REST surface (Express) — supersedes `03 §4.2`

Auth is JWT access + rotating refresh (unchanged from `03 §6`); the JWT carries
`account_id`, `account_type`, and `role`. Middleware resolves the **account subtree**
the caller may touch (company → all; retailer → its farmers; farmer → self).

```
# auth
POST   /auth/login            /auth/refresh            /auth/logout
GET    /me

# company-only  (role = company_admin)
POST   /company/retailers              GET /company/retailers
PATCH  /company/retailers/:id          # enable/disable, rename
GET    /company/fleet                  # all gateways, LWT health
POST   /company/gateways               # register serial → device token
POST   /company/gateways/:id/bind      # assign to a farmer's farm
POST   /company/gateways/:id/ota
PATCH  /accounts/:id/entitlements      # ★ company-only; edits a LOCKED farmer record
GET    /device-catalog                 # the modular catalog (also readable by retailer)

# retailer  (role = retailer_admin; scoped to own farmers)
GET    /retailer/farmers
POST   /retailer/farmers               # ★ body includes initial entitlements → locked:true
GET    /retailer/farmers/:id
PATCH  /retailer/farmers/:id           # profile only — NEVER entitlements (403 if attempted)

# farmer-scoped  (account from JWT; farmer_admin/operator/viewer)
GET    /farms     POST /farms     GET/PATCH/DELETE /farms/:id
GET    /farms/:id/zones    POST /zones    PATCH/DELETE /zones/:id
GET    /zones/:id/telemetry?from&to&agg=raw|5m|1h|1d
GET    /zones/:id/rules    PUT /zones/:id/rules
GET    /farms/:id/schedules     PUT /schedules/:id
PUT    /farms/:id/dosing-profile
POST   /actuators/:id/command          # {action: open|close|on|off|dose}  desired-vs-reported
GET    /alerts    POST /alerts/:id/ack
GET    /me/entitlements                 # farmer sees own entitlements (read-only)
```

Two hard server-side rules, tested first:

1. `PATCH /accounts/:id/entitlements` → **403 unless `company_admin`.**
2. `POST /retailer/farmers` → always writes `locked: true`; a retailer cannot create an
   unlocked farmer.

WebSocket live channel and the MQTT ingest bridge are unchanged from `03 §4.3` / `01 §4`
— they are farmer-scoped and don't interact with the account tree beyond carrying
`account_id`.

### 5.1 App ↔ API method map

Every method in `src/api/client.ts` has a 1:1 endpoint so the mock→real swap is free:

| App method | Endpoint |
|---|---|
| `login` | `POST /auth/login` |
| `overview`, `zone` | `GET /farms/:id` + `/zones/:id` |
| `setZoneMode`, `setValve`, `setSystem` | `POST /actuators/:id/command` |
| `alerts` | `GET /alerts` |
| `myCustomers`, `createCustomer` | `GET` / `POST /retailer/farmers` |
| `myRetailers`, `createRetailer` | `GET` / `POST /company/retailers` |
| `fleet` | `GET /company/fleet` |

---

## 6. Backend build order

1. Schema + migrations + seed: company root, 2 retailers, 3 farmers, `device_catalog`,
   one farm/gateway/3 zones (mirrors the app's mock seed for parity).
2. Auth + JWT + the **account-subtree scoping middleware** + audit log.
3. Account-tree endpoints + the two hard entitlement rules (§5) — **write the 403 and
   the auto-lock tests before anything else**.
4. Virtual gateway publishing fake MQTT telemetry → ingest worker → Postgres/Timescale
   → Redis → WebSocket (so the farmer screens go live against the real server).
5. Farmer-scoped CRUD + actuator commands (desired-vs-reported).
6. Alerts engine + offline (LWT) detection + push/email.
7. Company fleet + OTA + gateway binding.
8. Swap the app's `useMockApi` to `false`; end-to-end test all three roles.

---

## 7. The mobile app (this repo)

**Stack:** Expo SDK 55 (RN 0.83, React 19), Expo Router v6 (typed routes),
**expo-dev-client** (not Expo Go), react-native-svg, expo-secure-store, custom fonts.
SDK 56 (RN 0.85) was still beta at build time; upgrade path noted in the README.

**Design:** ported from the team's `teranode-twin-themed.html` light mode — parchment +
soil-ink palette, Instrument Serif (display) / Geist (UI) / JetBrains Mono (telemetry),
conic gauge rings, bar meters with target ticks, chip pills. Tokens in
`src/theme/tokens.ts`; oklch from the twin converted to hex (RN has no oklch).

**Routing by role** (`app/index.tsx` redirect):

```
company_admin   → (company)  Retailers · New retailer · Fleet · Account
retailer_admin  → (retailer) Customers · New customer · Account
farmer_*        → (farmer)   Field · History · Alerts · Account
```

**The three things the app proves:**

1. **Farmer experience** — live zone tiles, gauge/bar telemetry, auto/manual + valve
   control with desired-vs-reported pending state, history sparklines, alerts. Modules
   (weather, pump, dosing, reservoir…) **render only if the farmer is entitled** — driven
   entirely by the catalog + entitlements, never hardcoded.
2. **Retailer create-customer flow** (the centerpiece, `(retailer)/new-customer.tsx`) —
   modular toggles + count steppers grouped by category, a "locked at creation" warning,
   and a confirm-and-lock submit. After creation the retailer sees the farmer read-only.
3. **Create-time lock** — the farmer's Account screen and the retailer's customer list
   both show entitlements as locked; only `company_admin` (web) can change them later.

A **virtual gateway** in `src/api/mock.ts` drifts zone moisture and runs an edge-first
auto-control loop, so the whole app animates with no hardware and no server.

### 7.1 Running it

```bash
cd teranode-app
npx expo install --fix     # pin exact SDK-55 versions
npx expo prebuild          # dev-client needs native dirs
npm run ios                # or: npm run android
# quick look in a browser (no native modules): npm run web
```

Demo logins (one-tap on the sign-in screen):
`admin@teranode.io` (company) · `sales@himalayan.np` (retailer) ·
`farmer@greenvalley.np` (farmer).

---

## 8. Web portals (React — to build)

One React (Vite + TS) app, role-gated, sharing the `@teranode/types` package and the
same API. Two surfaces (a farmer/customer web panel can come later — the app covers
farmers for MVP):

**Company portal** (`company_admin`): retailer management (create/disable), fleet health
map from LWT, gateway registration + token issuance + binding, OTA rollout, audit log,
and the **entitlement editor** — the one place locked farmer entitlements can be changed.

**Retailer portal** (`retailer_admin`): farmer list, the **create-farmer wizard** (the web
twin of the app's create-customer screen — modular catalog toggles, locks on submit),
and farmer profile management (everything *except* entitlements once locked).

Build order mirrors the app: scaffold + auth/role routing → retailer create-farmer wizard
(reuse the catalog + lock logic) → company retailer mgmt + entitlement editor → fleet/OTA.

---

## 9. Repo / monorepo shape

Extends `03 §9`:

```
teranode/
  apps/
    mobile/   # ← this repo (Expo Dev Client app)
    web/      # React company + retailer portals (§8)
    api/      # Express REST + WebSocket (§5)
    ingest/   # MQTT → DB/Redis worker
  packages/
    types/    # shared TS: Account, Role, DeviceCatalogItem, Entitlements, Farm, Zone…
  infra/      # docker-compose: nginx, api, ingest, mosquitto, postgres(timescale), redis
```

The app's `src/types/models.ts` and `src/entitlements/*` are the seed for
`packages/types` — lift them up so web, app, and API share one definition of the account
tree, the catalog, and the lock predicate.

---

## 10. What changed vs. the original docs

| # | Original (docs `01`/`03`) | Now (this plan) | Why |
|---|---|---|---|
| 1 | Flat tenancy: Platform → Organization → Farm → Zone | **Account tree**: company → retailer → farmer → Farm → Zone | Team's 3-tier sales model (company sells via retailers to farmers) |
| 2 | `organizations` table | `accounts` table with `type` + self-ref `parent_id` | One table expresses all three tiers + the hierarchy |
| 3 | Roles: super_admin / org_admin / operator / viewer | company_admin / **retailer_admin** / farmer_admin / farmer_operator / farmer_viewer | New middle tier; old roles map onto the farmer tier |
| 4 | `organization_id` scoping | `account_id` scoping (the farmer is the tenant) + subtree access up the tree | Same isolation boundary, renamed; adds retailer/company reach |
| 5 | Company provisions customers directly | **Retailers** provision farmers; company provisions retailers | Matches who actually sells the product |
| 6 | Devices implied by farm hardware | **Data-driven `device_catalog` + per-farmer `entitlement_records`** | "Modular and dynamic" device on/off requirement |
| 7 | — (no concept) | **Create-time entitlement lock**: retailer sets once, only company edits after | Explicit team requirement; enforced by `canEditEntitlements` + API 403 |
| 8 | Expo (unversioned) | **Expo SDK 55 + Dev Client** (SDK 56 beta noted) | "Latest Expo + Dev Client" requirement; SDK 55 is the stable line |

Everything else from the docs — edge-first control, MQTT topics, the Postgres +
TimescaleDB + Redis stack, the gateway/zone hardware model, security posture, phased
roadmap — **stands unchanged**.
