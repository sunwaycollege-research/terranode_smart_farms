# Security & Access Control

TERANODE has three principal types — **operator (admin)**, **farmer (customer)**, and
**device** — each with a distinct authentication mechanism, plus hard multi‑tenant scoping and a
capability‑entitlement layer.

Canonical sources: `apps/api/src/middleware/auth.ts`, `apps/api/src/lib/jwt.ts`,
`apps/api/src/lib/authCookies.ts`, `apps/api/src/middleware/entitlements.ts`,
`apps/api/src/services/provisioning.ts`.

## 1. Identity & roles

```{list-table}
:header-rows: 1
:widths: 18 22 60

* - Principal
  - Credential
  - Notes
* - **Admin** (operator)
  - email + password → JWT
  - One company root account. Manages customers, entitlements, the device fleet, crop library, audit. Operates **above** per‑customer entitlement gates.
* - **Customer** (farmer)
  - email + password → JWT
  - Hard‑scoped to its own `accountId`. Sees only its farms/zones/devices/data.
* - **Device** (gateway)
  - `serial` + `secret` (bcrypt)
  - Authenticates only at `POST /provision`; thereafter publishes to its serial‑keyed MQTT topic. No JWT.
```

Roles are an enum on both `accounts.type` and `users.role` (`admin | customer`).

## 2. JWT: access + refresh, single‑use rotation

- **Access token** — short‑lived (~15 min), carries `JwtClaims { userId, accountId, accountType,
  role }`. Sent as `Authorization: Bearer <token>` and verified by `requireAuth`.
- **Refresh token** — long‑lived (~30 days), tracked in **Redis** and **single‑use**: each refresh
  rotates it (the old token is invalidated). Revoked on logout. Signed with a separate secret.

```{mermaid}
flowchart LR
  L["POST /auth/login"] --> AT["access (15m)"]
  L --> RT["refresh (30d, Redis-tracked)"]
  AT --> R["requests: Bearer access"]
  R -- "401" --> RF["POST /auth/refresh"]
  RT --> RF --> AT2["new access + rotated refresh"]
  LO["POST /auth/logout"] --> REV["revoke refresh"]
```

## 3. Client‑specific refresh handling

The refresh token is delivered differently per client so the credential is never left in a place
an attacker could read:

```{list-table}
:header-rows: 1
:widths: 16 84

* - Web
  - Refresh token lives in an **httpOnly, SameSite=Lax cookie** (path `/auth`, `Secure` in prod) — never in JS‑readable storage. A **stateless double‑submit CSRF token** (HMAC of the refresh token) is returned in the body and echoed back as `X-CSRF-Token` on `/auth/refresh` + `/auth/logout`. CORS runs with `credentials:true` (origin reflected, never `*`).
* - Mobile
  - Tokens are stored in **expo‑secure‑store** (Keychain/Keystore). The client refreshes on a 401 and persists rotated tokens; an unrecoverable 401 clears the session and routes to login.
```

## 4. Tenant scoping (the core guardrail)

Three middleware compose the access model (`auth.ts`):

- `requireAuth` — verifies the access token, attaches `req.auth` (claims).
- `requireAdmin` — admin‑only routes (the `/admin/*` surface, crop library writes).
- `scopeToCustomer` — derives `req.scope { accountId, isAdmin }`. A **customer is hard‑scoped** to
  its own `accountId`; an **admin may target any account** via `?accountId`. Services resolve
  ownership by walking `zone → farm → account` / `farm → account`, so a customer can never read or
  mutate another tenant's rows (foreign‑zone access returns **403/404**).

## 5. Capability entitlements (authorization layer)

On top of identity, **what** a customer can do is gated by a per‑account entitlement record seeded
from the device catalog (see {doc}`../reference/entitlements`):

- **Server‑side enforcement** — `requireEntitlement('analytics')` returns 403 unless the account's
  entitlement is on; admins bypass. The `zoneNodes` count is a **hard cap** on zone creation
  (`createZone` → 403 "zone limit reached").
- **Client gating** — the apps hide/disable features the account doesn't have (defence‑in‑depth,
  not the primary gate).

## 6. Device authentication & secrets

- Each gateway has a `device_tokens` row with a **bcrypt hash** of a `nanoid(40)` secret; the
  plaintext is shown **once** at registration and flashed onto the device.
- `POST /provision` is the only device‑facing endpoint and is **not** behind JWT — it
  authenticates by `serial + secret`. Unknown/revoked devices are rejected.
- MQTT (Mosquitto) is the broker; production should add per‑device ACLs and TLS (see
  {doc}`../operations/deployment`).

## 7. Secrets & configuration

All secrets come from environment variables (never committed): `JWT_ACCESS_SECRET`,
`JWT_REFRESH_SECRET`, `CSRF_SECRET`, `DATABASE_URL`, `REDIS_URL`, `MQTT_URL`, SMTP creds, and
`COOKIE_SECURE`. The repo ships dev placeholders in `.env.example`; production values must be set
out‑of‑band. Mutations by the operator are written to an **`audit_log`** (actor, action, target,
before/after).

## 8. Hardening checklist (production)

```{list-table}
:header-rows: 1
:widths: 40 60

* - Item
  - Status / action
* - JWT access+refresh, single‑use rotation
  - ✅ implemented
* - httpOnly refresh cookie + CSRF (web)
  - ✅ implemented
* - Secure token storage (mobile)
  - ✅ expo‑secure‑store
* - Tenant scoping + ownership walks
  - ✅ implemented + tested (foreign access → 403)
* - Entitlement enforcement server‑side
  - ✅ implemented
* - Strong secrets, `COOKIE_SECURE=true`, TLS
  - ⚙️ set in production env / behind nginx
* - Per‑device MQTT ACLs + broker TLS
  - ⚙️ recommended for production (see deployment)
```
