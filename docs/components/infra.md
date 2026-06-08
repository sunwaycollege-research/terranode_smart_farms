# Infrastructure (Docker)

The cloud dependencies run as containers via `infra/docker-compose.yml`. They provide the three
backing services the backend needs: **TimescaleDB** (durable store), **Redis** (live bus +
refresh‑token tracking), and **Mosquitto** (MQTT broker), plus optional **Mailpit** (dev SMTP) and
**nginx** (reverse proxy).

Source: `infra/docker-compose.yml`, `infra/mosquitto/mosquitto.conf`, `infra/nginx/nginx.conf`,
`infra/drizzle.config.ts`, root `.env`.

## 1. Services & ports

```{list-table}
:header-rows: 1
:widths: 18 26 18 38

* - Service
  - Image
  - Host port
  - Role
* - **timescaledb**
  - `timescale/timescaledb`
  - `5433 → 5432`
  - Postgres + Timescale. Remapped to **5433** because the host already runs Postgres on 5432.
* - **redis**
  - `redis`
  - `6380 → 6379`
  - Live pub/sub bus + refresh‑token store. Remapped to **6380** (host Redis on 6379).
* - **mosquitto**
  - `eclipse-mosquitto`
  - `1883`, `9001`
  - MQTT broker (TCP 1883, WebSocket 9001).
* - **mailpit**
  - `axllent/mailpit`
  - `1025`, `8025`
  - Dev SMTP sink (welcome emails); web UI on 8025.
* - **nginx**
  - `nginx`
  - profile `proxy`
  - Optional single‑origin reverse proxy (web + API + WS). Off by default.
```

:::{important}
The non‑standard host ports (5433/6380) are deliberate — this machine already runs Postgres:5432
and Redis:6379. `DATABASE_URL` / `REDIS_URL` in `.env` point at the remapped ports. Adjust if your
host ports are free.
:::

## 2. Bring it up

```bash
docker compose --env-file .env -f infra/docker-compose.yml up -d --wait \
  timescaledb redis mosquitto
# optional: ... mailpit ; and `--profile proxy up nginx` for the reverse proxy
```

Then apply the schema and seed reference data:

```bash
npm run -w @teranode/api migrate   # idempotent DDL (extensions, enums, hypertables, aggregates, policies)
npm run -w @teranode/api seed      # 14 crops + stages, device catalog, admin + demo customer
```

## 3. MQTT broker config

`infra/mosquitto/mosquitto.conf` (development):

```text
persistence true
persistence_location /mosquitto/data/
log_dest stdout
allow_anonymous true       # dev only — add per-device ACLs + auth for production
listener 1883
protocol mqtt
listener 9001
protocol websockets
```

- **TCP 1883** — devices + the ingest worker + the API command publisher.
- **WebSocket 9001** — browser MQTT clients (e.g. the digital twin).
- **Production:** disable anonymous, add per‑device username/ACL (the device's `serial`), and
  terminate TLS. See {doc}`../operations/deployment`.

## 4. Database engine notes

TimescaleDB is plain Postgres plus time‑series superpowers. The migration
(`apps/api/src/db/migrate.ts`) enables `timescaledb`, `pgcrypto`, `citext`; creates the enums and
tables ({doc}`../reference/data-model`); converts `telemetry` + `usage_events` into **hypertables**;
and adds **continuous aggregates** (rollups) + **retention/compression policies** so the raw
firehose stays cheap to store and fast to query.

## 5. How infra maps to the backend

```{mermaid}
flowchart LR
  FW["devices"] -->|MQTT 1883| MQ["mosquitto"]
  IN["ingest"] -->|sub| MQ
  IN -->|writes| TS[("timescaledb:5433")]
  IN -->|live pub| RD[("redis:6380")]
  API["api:4000"] -->|reads| TS
  API -->|sub live| RD
  API -->|refresh tokens| RD
  API -->|publish cmd| MQ
  API -->|SMTP| ML["mailpit:1025"]
```

Run order: **infra → migrate → seed → api → ingest → (virtual gateway) → web/mobile**. The full
runbook is in {doc}`../operations/run-guide`.
