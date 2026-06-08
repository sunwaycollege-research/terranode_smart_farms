# REST API Reference

The apps ⇄ API contract. All shapes come from `@teranode/types`. Mounted in
`apps/api/src/index.ts`; handlers in `apps/api/src/routes/*`.

**Conventions** — JSON in/out · `Authorization: Bearer <access>` on authed routes · errors are
`{ error, details? }` with a proper status · customer requests are hard‑scoped to their account;
admins may target any account via `?accountId` (see {doc}`../architecture/security`).

## Auth & identity — `/auth`, `/me`

```{list-table}
:header-rows: 1
:widths: 30 12 58

* - Endpoint
  - Auth
  - Purpose
* - `POST /auth/login`
  - public
  - email + password → `{ accessToken, user, account, csrfToken }`; sets httpOnly refresh cookie (web) or returns refresh (mobile).
* - `POST /auth/refresh`
  - cookie/refresh
  - rotate tokens (single‑use); web sends `X-CSRF-Token`.
* - `POST /auth/logout`
  - authed
  - revoke the refresh token + clear cookie.
* - `GET /me`
  - authed
  - current `{ user, account }`.
* - `GET /me/entitlements`
  - authed
  - the caller account's entitlement values + catalog.
```

## Admin — `/admin/*` (admin only)

```{list-table}
:header-rows: 1
:widths: 38 62

* - Endpoint
  - Purpose
* - `GET /admin/customers`
  - list customers + entitlements
* - `POST /admin/customers`
  - create account + owner user + default entitlements (welcome email)
* - `GET /admin/customers/:id`
  - one customer + entitlements
* - `PATCH /admin/customers/:id`
  - rename / enable / disable / plan / locale
* - `PATCH /admin/customers/:id/entitlements`
  - edit entitlement values
* - `DELETE /admin/customers/:id`
  - **cascade‑delete** the customer + all farms/devices/telemetry (admin protected)
* - `GET /admin/fleet`
  - all gateways + status summary + bindings
* - `GET /admin/farms`
  - every farm across customers (admin pickers)
* - `POST /admin/gateways`
  - register a serial → one‑time device secret
* - `POST /admin/devices/:serial/claim`
  - claim an in‑stock device to a customer
* - `POST /admin/gateways/:id/bind` · `…/ota`
  - bind to a farm; record an OTA target
* - `DELETE /admin/gateways/:id`
  - delete a device (+ tokens/nodes; detaches zones)
* - `GET /admin/audit`
  - recent audit log
```

## Farms & zones — `/farms`, `/zones`

```{list-table}
:header-rows: 1
:widths: 40 60

* - Endpoint
  - Purpose
* - `GET /farms`
  - the caller's farm(s)
* - `GET /farms/:id/zones`
  - zones (each with its crop ref)
* - `GET /farms/:id/gateway`
  - the bound ESP32 (serial + status) or null
* - `GET /farms/:id/actuators`
  - pump/dosing + per‑zone valves
* - `GET /farms/:id/readings`
  - newest value per channel across the farm (soil + weather + flow)
* - `POST /zones`
  - **create a zone** (capped by the `zoneNodes` entitlement → 403 at the cap)
* - `GET /zones/:id`
  - a single zone (crop, mode, farm)
* - `PATCH /zones/:id`
  - rename / area / node / mode
* - `DELETE /zones/:id`
  - delete a zone (+ its rules/channels)
* - `POST /zones/:id/assign`
  - assign crop + planting date + channels; derives the rule
* - `GET /zones/:id/analysis`
  - `analyzeZone` output (stage, health, channels, recs, rule). **409** if no crop yet.
* - `GET /zones/:id/telemetry?agg=`
  - time series (raw / 5m / 1h / 1d)
* - `POST /zones/:id/valve`
  - open/close the zone valve (desired‑vs‑reported)
```

## Control, alerts, harvest

```{list-table}
:header-rows: 1
:widths: 40 60

* - Endpoint
  - Purpose
* - `POST /actuators/:id/command`
  - actuator command (`open/close/on/off/dose`)
* - `GET /rules/zones/:id` · `PUT /rules/zones/:id`
  - read / hand‑edit the per‑zone irrigation rule
* - `GET /alerts` · `POST /alerts/:id/ack`
  - list / acknowledge alerts
* - `GET /harvest` · `POST /harvest`
  - harvest log read / add
```

## Crops, analytics, catalog

```{list-table}
:header-rows: 1
:widths: 40 60

* - Endpoint
  - Purpose
* - `GET /crops` · `GET /crops/:id`
  - crop library (bands + stages); admin can create/update
* - `GET /analytics/usage` · `…/savings` · `…/export`
  - usage buckets · savings vs baseline · CSV. **Entitlement‑gated** (`analytics`).
* - `GET /device-catalog`
  - the 9 catalog modules (entitlement editor source)
```

## Device‑facing — `/provision` (no JWT)

```{list-table}
:header-rows: 1
:widths: 30 70

* - Endpoint
  - Purpose
* - `POST /provision`
  - `{ serial, secret, capabilities }` → `202 pending` (unclaimed) or `200 { accountId, farmId, gatewayId, mqttUrl, topicPrefix }` (auto‑provisions the farm on first boot). See {doc}`../architecture/device-lifecycle`.
```

## Real‑time — `/live` (WebSocket)

Connect to `ws(s)://<api>/live` with the access token; subscribe to the account's farms and receive
telemetry/state pushes from the Redis live bus. See {doc}`../architecture/data-flow`.

:::{note}
This reference groups endpoints by router for orientation; the **authoritative** signatures + zod
schemas live in `apps/api/src/routes/*` and the DTOs in `packages/types/src/dto.ts`.
:::
