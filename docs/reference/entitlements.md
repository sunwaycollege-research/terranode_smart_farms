# Entitlements & Device Catalog

What a customer can see and do is governed by a **per‑account entitlement record**, seeded from a
**device catalog**. This is the authorization layer on top of identity (see
{doc}`../architecture/security`).

Canonical sources: `packages/types/src/catalog.ts` (the catalog), `device_catalog` +
`entitlement_records` tables, `apps/api/src/services/entitlements.ts`,
`apps/api/src/middleware/entitlements.ts`.

## 1. The catalog (9 modules)

```{list-table}
:header-rows: 1
:widths: 22 14 12 14 38

* - Key
  - Category
  - Kind
  - Default
  - Meaning
* - `zoneNodes`
  - sensing
  - count
  - 3
  - Number of wireless sensor nodes (one per zone). **Caps zone creation.**
* - `mainPump`
  - actuation
  - toggle
  - on
  - Primary irrigation pump control.
* - `fertigation`
  - actuation
  - toggle
  - on
  - EC/pH dosing pumps for nutrient injection.
* - `weatherMast`
  - sensing
  - toggle
  - on
  - Air temp / humidity / pressure / rain station.
* - `reservoirMonitoring`
  - sensing
  - toggle
  - off
  - Tank level sensing.
* - `flowMeter`
  - sensing
  - toggle
  - off
  - Inline flow metering for accurate water usage.
* - `otaManaged`
  - platform
  - toggle
  - on
  - OTA firmware updates managed by TERANODE.
* - `mobileApp`
  - platform
  - toggle
  - on
  - Customer mobile app access. *(gates dashboard)*
* - `analytics`
  - platform
  - toggle
  - off
  - Usage trends, savings, harvest analytics. *(gates dashboard)*
```

`kind` is either a **count** (a number, "on" when > 0) or a **toggle** (boolean). The DB
`device_catalog` table is seeded from this list; the entitlement editors (web + `GET
/me/entitlements`) render from it.

## 2. How an account gets entitlements

```{mermaid}
flowchart LR
  CAT["DEVICE_CATALOG (9 modules)"] --> DEF["defaultEntitlements()"]
  DEF --> CREATE["POST /admin/customers → seed entitlement_records"]
  CREATE --> EDIT["admin: PATCH /admin/customers/:id/entitlements"]
  EDIT --> REC[("entitlement_records.values (jsonb)")]
```

On customer creation the record is seeded with the catalog defaults; the operator then tunes it
(e.g. set `zoneNodes` to how many nodes the customer bought, turn `analytics` on).

## 3. Enforcement

```{list-table}
:header-rows: 1
:widths: 30 70

* - Layer
  - Mechanism
* - **Server (authoritative)**
  - `requireEntitlement('analytics')` → 403 unless the account's value is on (`entitlementEnabled` = count>0 or truthy). Admins bypass. `zoneNodes` is a **hard cap**: `createZone` returns 403 `zone limit reached (used/cap)` once the count is hit.
* - **Client (defence‑in‑depth)**
  - The web + mobile hide/disable features the account lacks. `gatesDashboard` items (e.g. `mobileApp`, `analytics`) drive whole‑section visibility.
```

## 4. Reading entitlements

- **Customer:** `GET /me/entitlements` → `{ accountId, values, catalog }`.
- **Admin:** `GET /admin/customers/:id` includes the customer's entitlements; edit via
  `PATCH /admin/customers/:id/entitlements { values }`.

## 5. Example record

```json
{
  "accountId": "…",
  "values": {
    "zoneNodes": 3, "mainPump": true, "fertigation": true, "weatherMast": true,
    "reservoirMonitoring": false, "flowMeter": true, "otaManaged": true,
    "mobileApp": true, "analytics": true
  }
}
```

A customer with `zoneNodes: 3` can create at most 3 zones; the 4th `POST /zones` is rejected with
403 — and the mobile *Add a zone* wizard shows an "all your nodes are in use" state.
