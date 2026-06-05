# TERANODE — Run Guide

Crop-driven smart irrigation + fertigation IoT platform. Monorepo:
**Express API + MQTT ingest + virtual gateway (backend)**, **React/Vite web admin**,
**React Native (Expo) customer app**, shared `@teranode/types` + `@teranode/agronomy`
packages, on **Postgres/TimescaleDB + Redis + Mosquitto** via Docker.

Two roles: **admin** (web console — manages customers, fleet/gateways, crop library,
entitlements, audit, analytics) and **customer/farmer** (mobile app — crop-aware live
dashboard, zone health, assign-crop+sensors flow, analytics, alerts).

## Prerequisites
- Docker + Docker Compose, Node 20+ (built on Node 24), one `npm install` at the repo root.

## 0. Install
```bash
npm install            # root; hoists workspaces, links @teranode/*
cp .env.example .env   # already present in this checkout
```
`.env` (root) is also copied to `apps/api/.env` and `apps/ingest/.env`. **Note:** this
machine already runs Postgres on 5432 and Redis on 6379, so the containers are remapped to
**host ports 5433 / 6380** in `.env` (`DATABASE_URL=...localhost:5433...`, `REDIS_URL=...6380`).
Adjust if your host ports are free.

## 1. Infrastructure (TimescaleDB + Redis + Mosquitto)
```bash
docker compose --env-file .env -f infra/docker-compose.yml up -d --wait timescaledb redis mosquitto
```
(The `nginx` service is optional and only needed for a single-origin reverse proxy.)

## 2. Database: migrate + seed
```bash
npm run -w @teranode/api migrate    # idempotent: tables, hypertables, continuous aggregates, policies
npm run -w @teranode/api seed       # 14 crops + stages, device catalog, admin + customer, farm/gateway/3 zones
```

## 3. Backend: API + ingest + virtual gateway
```bash
npm run -w @teranode/api dev         # REST + WebSocket on http://localhost:4000 (ws: /live)
npm run -w @teranode/ingest start    # MQTT -> Postgres/Redis ingest worker
npm run -w @teranode/ingest virtual  # hardware-free "virtual gateway" — drives live telemetry
```
The virtual gateway replays the edge irrigation hysteresis and publishes telemetry over
MQTT; the ingest worker writes it to TimescaleDB and fans out live updates over Redis →
the API's `/live` WebSocket. With it running, `GET /zones/:id/analysis` shows a live 0–100
health score + recommendations, and `GET /zones/:id/telemetry?agg=raw` returns samples.

## 4. Web admin (React + Vite)
```bash
npm run -w @teranode/web dev         # http://localhost:5173  (VITE_API_URL defaults to :4000)
```
Log in as **admin@teranode.io / teranode**.

## 5. Mobile customer app (Expo)
```bash
npm run -w @teranode/mobile web      # browser preview;  or: npm run -w @teranode/mobile ios | android
```
Log in as **farmer@greenvalley.np / teranode**.

By default the app runs against its **built-in simulation mock** (`app.json` →
`extra.useMockApi: true`) so it is fully interactive with no backend — it reuses the same
`@teranode/agronomy` engine, so health/recommendations match the server. To point the app
at the **live API**, set `extra.useMockApi: false` (and `extra.apiBaseUrl` to your API URL,
using the machine's LAN IP for a physical device) and restart Expo.

## Demo logins
| Role | Email | Password | Surface |
|---|---|---|---|
| Admin | admin@teranode.io | teranode | Web console (:5173) |
| Customer | farmer@greenvalley.np | teranode | Mobile app |

## Verified status
- **Backend (live, proven):** Postgres/Timescale schema + migrate + seed; JWT auth (both roles);
  all REST route groups (admin/customers/entitlements/fleet/gateways/audit, farms, zones +
  `/zones/:id/assign` + `/zones/:id/analysis`, rules/schedules/dosing, alerts, harvest, crops,
  analytics + CSV); RBAC (customer→admin = 403); MQTT virtual-gateway → ingest → TimescaleDB →
  continuous-aggregate rollups; WebSocket `/live` push (telemetry received end-to-end).
- **Web admin (live):** typechecks + `vite build` succeeds; talks to the live API.
- **Mobile app:** typechecks + Metro web bundle succeeds; runs on the simulation mock by
  default; the live-API path is wired (flag flip) — known follow-ups before relying on live
  mobile: valve/pump control resolves an actuator id from the zone (the live `setValve`
  convenience currently assumes mock), and full on-device testing against the live API.

## Repo layout
```
apps/   mobile (Expo) · web (Vite admin) · api (Express REST+WS) · ingest (MQTT worker + virtual gateway)
packages/  types (shared) · agronomy (14-crop library + engine)
infra/  docker-compose.yml · mosquitto/ · nginx/ · (migrations live in apps/api/src/db)
firmware/  ESP32 Wokwi sketch    simulator/  HTML digital twin    docs/  planning + BUILD-SPEC.md
```
Build orchestration scripts used to generate this product live at the repo root
(`teranode-*.workflow.js`) and `docs/BUILD-SPEC.md` is the authoritative spec.
