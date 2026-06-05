# 🌱 Project TERANODE

> **Outdoor, soil-based smart irrigation + fertigation, delivered as a multi-tenant IoT SaaS.**
> A field "brain" that waters and feeds each part of a farm exactly when and how much it needs, controllable from a phone or browser.

## Repository layout

```
TerraNode/
├── Frontend_app/      React Native (Expo SDK 55) — customer/retailer/company app
├── shared_Backend/    Express API — shared by mobile, future web, gateway ingest
├── firmware/          ESP32 Arduino sketch (Wokwi sim of the field "brain")
├── simulator/         teranode-twin.html — animated browser digital twin
├── docs/              Planning docs (01–07, DEVELOPMENT-PLAN, SIMULATIONS)
│   └── assets/        BOM PDF + reference photos
├── package.json       Workspaces root + scripts
└── README.md
```

`Frontend_app` and `shared_Backend` are **npm workspaces** — one install at the root hoists everything; the two packages link to each other under `node_modules/@teranode/`.

## Quick start

```bash
npm install                # one install at the root
npm run dev                # runs API (:4000) + mobile web concurrently
```

Or run pieces individually:

```bash
npm run api                # Express API in watch mode (http://localhost:4000)
npm run mobile:web         # Expo for browser
npm run mobile             # Expo dev client for iOS/Android
npm run mobile:doctor      # check Expo SDK alignment
```

By default the mobile app uses its **in-app mock** so it works offline. To hit the real Express backend, edit `Frontend_app/app.json`:

```json
"extra": {
  "apiBaseUrl": "http://localhost:4000",
  "useMockApi": false
}
```

(For a phone on the same Wi-Fi, replace `localhost` with the LAN IP of the machine running the API.)

## What lives where

### `Frontend_app/` — the mobile app
Expo SDK 55 + expo-router + React Native 0.83. See [`Frontend_app/README.md`](./Frontend_app/README.md).

```
Frontend_app/
├── app/        ← expo-router routes (see "What is app/?" below)
├── src/        ← non-route code (api client, theme, types, components, auth)
├── app.json
├── babel.config.js
├── package.json
└── tsconfig.json
```

#### What is `app/`?
`app/` is the **expo-router routes folder** — file-based routing, like Next.js's `app/` or `pages/`. Every `.tsx` file under it becomes a screen, and folders become nested navigators.

In this project:
- **`app/_layout.tsx`** — root layout. Loads fonts, sets up `AuthProvider`, `SafeAreaProvider`, `GestureHandlerRootView`, declares the top-level `Stack` and which child groups it routes to.
- **`app/index.tsx`** — the entry screen (renders at `/`, decides where to send the user based on auth state).
- **`app/(auth)/login.tsx`** — login screen at `/login`.
- **`app/(farmer)/dashboard.tsx`** — farmer dashboard at `/dashboard`.
- **`app/(farmer)/zones/[zoneId].tsx`** — dynamic route for a single zone at `/zones/z_1` etc.

The **parenthesized folders `(auth)` `(farmer)` `(retailer)` `(company)`** are **route groups**: parens hide the folder name from the URL but still let you give that group its own `_layout.tsx`. They exist to keep screens per role neatly separated without making every URL `/farmer/dashboard`.

Anything that isn't a route (API client, theme tokens, model types, reusable components, auth context) lives under `src/` so the router doesn't try to turn it into a screen.

### `shared_Backend/` — the Express API
TypeScript + Express + in-memory store. See [`shared_Backend/README.md`](./shared_Backend/README.md) for the route list. The store mirrors the mobile app's mock so behaviour is identical whether the client is in mock mode or hitting the real server; swap in PostgreSQL + Timescale later by replacing `src/store.ts` only.

### `firmware/` — the ESP32 field brain
Arduino sketch runnable on [wokwi.com](https://wokwi.com). Real sensors, valves, LCD, MQTT-shaped JSON output. See [`firmware/README.md`](./firmware/README.md).

### `simulator/` — the animated digital twin
A single self-contained HTML page (`teranode-twin.html`) showing the whole field "alive". Double-click to open. See [`docs/SIMULATIONS.md`](./docs/SIMULATIONS.md).

## Document map

| Doc | What's inside |
|---|---|
| [docs/01-System-Architecture.md](./docs/01-System-Architecture.md) | Tenancy, edge→cloud→app flow, MQTT topics, data model. **Start here.** |
| [docs/02-IoT-Hardware-and-Firmware.md](./docs/02-IoT-Hardware-and-Firmware.md) | Gateway + zone nodes, sensors, actuators, LoRa, power, control logic. |
| [docs/03-Web-and-Mobile-App.md](./docs/03-Web-and-Mobile-App.md) | React Native + Express + Postgres/Timescale; auth/RBAC; provisioning. |
| [docs/04-Roadmap-and-Phased-Plan.md](./docs/04-Roadmap-and-Phased-Plan.md) | Phases 0→3, milestones, scope, risks. |
| [docs/05-BOM-and-Cost.md](./docs/05-BOM-and-Cost.md) | Bill of materials + NPR/USD costs. |
| [docs/06-Field-Deployment-and-Ops.md](./docs/06-Field-Deployment-and-Ops.md) | Install, plumb, calibrate, commission, maintain. |
| [docs/07-Business-and-GTM.md](./docs/07-Business-and-GTM.md) | Market, users, competitors, pricing, GTM. |
| [docs/DEVELOPMENT-PLAN.md](./docs/DEVELOPMENT-PLAN.md) | End-to-end build plan + API contract. |
| [docs/SIMULATIONS.md](./docs/SIMULATIONS.md) | How to run the digital twin + Wokwi firmware sim. |

## Confirmed decisions

| Topic | Decision |
|---|---|
| Gateway compute | **ESP32** is the gateway brain; Raspberry Pi 4 is optional. |
| Water delivery | Pump **+** per-zone solenoid valves. |
| Fertigation | In scope — auto nutrient dosing pumps. |
| Architecture | **Multi-tenant cloud from day one**; master dashboard provisions customers; one gateway per farm; farms split into zones. |
| Onboarding | Manual provisioning for MVP; payments deferred. |
| Stack | React Native + Express + PostgreSQL/Timescale. |
| Hosting | Self-managed VPS via Docker. |

## Status

Planning docs are complete; the mobile shell + Express stub are in place. No production hardware yet — source materials (procurement PDF, reference photos) live under `docs/assets/`.
