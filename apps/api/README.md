# @teranode/backend

TERANODE Express API. Shared across `Frontend_app` (and the future web
dashboard / gateway ingest). In-memory store today, PostgreSQL + Timescale +
MQTT bridge later — see [`docs/01-System-Architecture.md`](../docs/01-System-Architecture.md)
and [`docs/03-Web-and-Mobile-App.md`](../docs/03-Web-and-Mobile-App.md).

## Quick start

```bash
# from the repo root
npm install               # one install, hoisted by workspaces
npm run api               # tsx watch — restarts on file changes
# server: http://localhost:4000
# health: http://localhost:4000/healthz
```

You can also run it directly from this folder:

```bash
npm run -w @teranode/backend dev
```

Environment: copy `.env.example` to `.env` and override `PORT` / `CORS_ORIGIN`
as needed. `dotenv/config` is loaded automatically.

## Routes (mirror of the mobile client surface)

| Method | Path | Notes |
|---|---|---|
| `GET`  | `/healthz` | Liveness probe. |
| `POST` | `/auth/login` | Body `{ email }`. Mock-grade — returns `{ token, user, account }`. |
| `GET`  | `/farms/me/overview` | Composite: `{ zones, systems, weather }`. Drifts readings each call (virtual gateway). |
| `PUT`  | `/farms/me/systems` | Body `{ pumpOn?, dosingOn? }`. |
| `GET`  | `/zones/:zoneId` | |
| `PUT`  | `/zones/:zoneId/mode` | Body `{ mode: 'auto' \| 'manual' }`. |
| `POST` | `/actuators/:zoneId/command` | Body `{ action: 'open' \| 'close' }`. Ignored if zone is in `auto`. |
| `GET`  | `/alerts` | |
| `GET`  | `/retailer/customers` | Query `retailerId=` for now (replace with JWT later). |
| `POST` | `/retailer/customers` | Body `{ name, entitlements }`. |
| `GET`  | `/admin/retailers` | |
| `POST` | `/admin/retailers` | Body `{ name }`. |
| `GET`  | `/admin/fleet` | Every farm + its gateway. |

## Pointing the mobile app at this server

In `Frontend_app/app.json`:

```json
"extra": {
  "apiBaseUrl": "http://localhost:4000",
  "useMockApi": false
}
```

For a phone on the same Wi-Fi, swap `localhost` for the LAN IP of the machine
running the API (e.g. `http://192.168.1.42:4000`).

## Layout

```
shared_Backend/
├── src/
│   ├── index.ts         Express app: middleware + route mounting + listen
│   ├── store.ts         In-memory state + virtual gateway (mirrors mock.ts)
│   ├── types.ts         Domain types served by the API
│   └── routes/          One router per resource — thin, store-only
├── tsconfig.json
├── .env.example
└── package.json
```

## Replacing the in-memory store

`src/store.ts` is the single seam. When you migrate to PostgreSQL / Timescale,
re-export the same functions (`driftZones`, `getSystems`, `setZoneMode`, …)
from DB-backed implementations — no route file needs to change.
