# Web Admin Panel

The **operator console** — a React 18 + Vite + TypeScript SPA used by the company (admin role) to
manage customers, the device fleet, entitlements, the crop library, analytics, and audit.

Source: `apps/web/src/`. API client: `apps/web/src/api/client.ts`.

## 1. Structure

```
apps/web/src/
├── api/client.ts        typed REST client (Bearer + httpOnly refresh cookie + CSRF)
├── auth/                AuthContext (login/logout, token store, 401 handling)
├── components/          shared UI: Button, Table, Card, Badge, Select, Switch, TextField,
│                        Stat, PageHeader, NavSidebar, LanguageSwitcher
├── pages/
│   ├── login/           operator sign-in
│   ├── customers/       list + create wizard + detail + entitlement editor + delete
│   ├── fleet/           device fleet health: register, claim, bind, OTA, filter, delete
│   ├── crops/           crop library: band editor + fertilizer schedule tab
│   ├── analytics/       usage / savings charts (recharts) + export
│   └── audit/           audit log table
├── i18n/                react-i18next (EN/NE) + per-page namespaces
└── theme / global.css   tn-* class system, focus rings, accessible tables
```

## 2. Pages

```{list-table}
:header-rows: 1
:widths: 18 82

* - Page
  - What the operator does
* - **Customers**
  - List customers + entitlements; a *create wizard* (account + owner login + module entitlements, password shown once); a *detail* view (rename/enable/disable, entitlement editor, farms & gateways summary); and a **Danger‑zone delete** (cascades the customer + all their data).
* - **Fleet**
  - Device‑health dashboard: count tiles (total/online/offline/claimed/in‑stock), per‑device status badge + relative last‑seen + firmware + bound customer/farm, a status filter, and actions: **Register** (→ one‑time secret), **Claim to customer**, **Bind**, **OTA**, **Delete**.
* - **Crops**
  - The crop library: edit per‑stage agronomic bands; a read‑only **Fertilizer schedule** tab rendered from `@teranode/agronomy`'s `fertilizerSchedule()` (TNAU/JICA/NAST doses by stage).
* - **Analytics**
  - Usage + savings charts (recharts) for a selected farm; CSV export. Entitlement‑gated.
* - **Audit**
  - The `audit_log` of operator mutations (actor, action, target, before/after).
* - **Login**
  - Operator sign‑in (admin role). Non‑admins are blocked from the console.
```

## 3. API client + auth

`api/client.ts` is a thin typed wrapper over `fetch` using `@teranode/types`:

- Attaches `Authorization: Bearer <access>` and `credentials:'include'` (so the httpOnly refresh
  cookie flows on `/auth/*`); sends `X-CSRF-Token` on refresh/logout.
- On a 401 it transparently calls `/auth/refresh` (cookie + CSRF) once and replays the request;
  an unrecoverable 401 clears the session and routes to login.
- `AuthContext` stores only the access token + CSRF token (the refresh token stays in the httpOnly
  cookie). Admin‑only route gating is enforced both client‑side and server‑side.

## 4. Look & feel

A light, scannable enterprise UI built on a `tn-*` CSS convention: consistent cards/tables/badges,
a `:focus-visible` ring, keyboard‑accessible table rows, **lucide‑react** icons in the nav, and
react‑i18next for EN/NE. Charts use recharts.

## 5. Reusing the agronomy package

The web imports `@teranode/agronomy` **directly** (it's a workspace dependency) — e.g. the crop
library's fertilizer tab calls `fertilizerSchedule(cropId)` so the operator sees the exact same
guidance the farmer app surfaces. See {doc}`packages`.

## 6. Run

```bash
npm run -w @teranode/web dev      # Vite dev server
# VITE_API_URL defaults to http://localhost:4000
```
