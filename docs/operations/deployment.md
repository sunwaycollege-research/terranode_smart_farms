# Deployment (Production)

The local stack ({doc}`run-guide`) maps directly to production. This page covers what changes when
you ship it. (Field hardware install — enclosures, antenna, calibration — is in
`docs/06-Field-Deployment-and-Ops.md`.)

## 1. Topology

```{mermaid}
flowchart TB
  subgraph Edge["Field (per farm)"]
    FW["ESP32 gateways"]
  end
  subgraph Cloud["Cloud / VPS"]
    NG["nginx (TLS)"]
    API["api (N instances)"]
    IN["ingest worker"]
    MQ["mosquitto (TLS + ACL)"]
    TS[("TimescaleDB")]
    RD[("Redis")]
    NG --> API
    API --> TS
    API --> RD
    IN --> TS
    IN --> RD
    IN --> MQ
    API --> MQ
  end
  FW -- "MQTT/TLS 8883" --> MQ
  FW -- "HTTPS /provision" --> NG
  WEB["web (static/CDN)"] --> NG
  MOB["mobile app"] --> NG
```

## 2. Per‑service notes

```{list-table}
:header-rows: 1
:widths: 18 82

* - Service
  - Production guidance
* - **nginx**
  - Single‑origin reverse proxy + **TLS termination** for the API (REST + the `/live` WebSocket upgrade) and the static web build. Enable the compose `proxy` profile / `infra/nginx/nginx.conf`.
* - **api**
  - Stateless → run multiple instances behind nginx. Set strong `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, `CSRF_SECRET`; `COOKIE_SECURE=true`; restrict `CORS_ORIGIN` to your domains.
* - **ingest**
  - Single worker is fine to start (idempotent writes). Scale by sharding MQTT topic subscriptions if volume grows.
* - **mosquitto**
  - Disable `allow_anonymous`; add **per‑device auth + ACLs** (the device's `serial` as username, scoped to `teranode/dev/<serial>/#`); terminate **TLS (8883)**. Devices use their provisioning secret.
* - **TimescaleDB**
  - Managed Postgres + Timescale, or a tuned container with persistent volumes + backups. Retention/compression policies are created by the migration.
* - **Redis**
  - Persistent + password‑protected. Carries the live bus + refresh‑token store.
* - **web**
  - `vite build` → static assets on a CDN / nginx; point `VITE_API_URL` at the API origin.
* - **mobile**
  - EAS/Expo build; set `extra.apiBaseUrl` to the public API origin; `extra.useMockApi=false`.
```

## 3. Configuration & secrets

All via environment (never committed): `DATABASE_URL`, `REDIS_URL`, `MQTT_URL`,
`JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, `CSRF_SECRET`, `COOKIE_SECURE`, `CORS_ORIGIN`,
SMTP creds, `PORT`. Replace the dev placeholders in `.env.example`.

## 4. Migrations & seed

`migrate` is **idempotent** — safe to run on every deploy. `seed` loads reference data (crops,
device catalog) + a demo account; in production seed only the reference data (crops + catalog) and
create the real admin out‑of‑band.

## 5. Observability & ops

- **Health:** `GET /healthz`. Add uptime checks on the API + a heartbeat on the ingest worker.
- **Liveness alerts** are built in (gateway online/offline → `alerts`); surface them to the
  operator + optionally to email/SMS.
- **Backups:** TimescaleDB (PITR), and Redis if you rely on persisted refresh tokens.
- **OTA:** the `otaManaged` entitlement + `POST /admin/gateways/:id/ota` record firmware targets;
  pair with a firmware artifact host for real OTA.

## 6. Hardening checklist

See {doc}`../architecture/security` §8 — the must‑dos: strong secrets, `COOKIE_SECURE=true`, TLS
everywhere (nginx + MQTT 8883), per‑device MQTT ACLs, scoped CORS, DB/Redis auth + backups.
```
