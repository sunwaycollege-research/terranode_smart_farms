# Run Guide (Local)

How to bring the whole stack up locally. The authoritative quick‑start also lives in the repo‑root
`RUN.md`; this page adds the component context.

## Prerequisites

- Docker + Docker Compose, Node 20+ (built on Node 24).
- One `npm install` at the repo root (npm workspaces hoist + link `@teranode/*`).
- `.env` present (copied from `.env.example`). **Note:** this machine already runs Postgres:5432
  and Redis:6379, so the containers are remapped to **5433 / 6380** in `.env`.

## 0. Install

```bash
npm install
cp .env.example .env   # if not already present
```

## 1. Infrastructure

```bash
docker compose --env-file .env -f infra/docker-compose.yml up -d --wait \
  timescaledb redis mosquitto
```

## 2. Database

```bash
npm run -w @teranode/api migrate   # idempotent DDL (tables, hypertables, aggregates, policies)
npm run -w @teranode/api seed      # 14 crops + stages, device catalog, admin + demo customer/farm
```

## 3. Backend

```bash
npm run -w @teranode/api dev        # REST + WebSocket on http://localhost:4000 (ws: /live)
npm run -w @teranode/ingest start   # MQTT → Postgres/Redis ingest worker
```

## 4. Live data (choose one — hardware‑free)

```bash
# A) drive the seeded demo farm
npm run -w @teranode/ingest virtual

# B) bring a specific claimed device "online" (device-id-first, like real firmware)
SERIAL=TN-ESP32-BHUWAN SECRET=<device-secret> API_BASE=http://localhost:4000 \
  MQTT_URL=mqtt://localhost:1883 npx tsx apps/ingest/src/virtual/device-sim.ts
```

See {doc}`../components/simulator` for which simulator to use.

## 5. Clients

```bash
npm run -w @teranode/web dev        # admin panel (Vite)
npm run -w @teranode/mobile start   # Expo farmer app
```

- **Mobile on a device:** set `apps/mobile/app.json → extra.apiBaseUrl` to your machine's LAN IP
  (or rely on the client's auto host‑detection from the Metro host).
- **Demo logins** (after seed): admin `admin@teranode.io` / `teranode`; the farmer demo button uses
  the seeded `farmer@greenvalley.np` / `teranode`.

## End‑to‑end smoke test

```{mermaid}
flowchart LR
  I["infra up"] --> M["migrate + seed"] --> A["api dev"] --> N["ingest start"]
  N --> S["virtual / device-sim"] --> DB["telemetry rows"]
  A --> W["web: customers/fleet"]
  A --> MO["mobile: live dashboard"]
```

1. Register a device (web Fleet) → claim it to a customer → run the **device‑sim** with its secret.
2. Sign into the mobile app as that customer → the farm + live readings appear with no pairing.
3. Toggle `analytics` off for the customer (web) → the Analytics tab disappears **and** the API
   returns 403 — confirming entitlement enforcement.

Full operational detail (troubleshooting the stray watcher, port conflicts, etc.) is in `RUN.md`.
```
