# Ingest Worker

A headless Node worker that turns the MQTT firehose into durable telemetry + a live bus. It also
hosts the **virtual gateway** and **device simulator** for hardware‑free runs (see
{doc}`simulator`).

Source: `apps/ingest/src/index.ts` (worker loop) + `apps/ingest/src/handlers/*`.

## 1. What it does

```{mermaid}
flowchart LR
  MQ["Mosquitto"] -->|messages| DISP["dispatch()"]
  DISP --> PT["parseTopic"]
  PT --> RES{"device-id-first?"}
  RES -- yes --> RD2["resolveDevice(serial)\n→ account/farm/gateway/zoneIds"]
  RES -- no --> LEG["legacy account/farm/gateway from topic"]
  RD2 --> CH["resolve channel UUID\n(zone|farm, type)"]
  LEG --> CH
  CH --> W["INSERT telemetry (Timescale)"]
  CH --> PUB["publish live → Redis"]
  DISP --> ACT["actuator state + usage"]
  DISP --> LV["markSeen → liveness"]
```

## 2. Subscriptions

The worker subscribes to both topic families (`apps/ingest/src/index.ts`):

```text
# device-id-first (preferred — device knows only its serial)
teranode/dev/+/telemetry/zone/+
teranode/dev/+/telemetry/weather
teranode/dev/+/telemetry/gateway/health
teranode/dev/+/state/#
# (legacy explicit-triple teranode/{account}/{farm}/{gateway}/… is also parsed)
```

## 3. Handlers

```{list-table}
:header-rows: 1
:widths: 22 78

* - File
  - Responsibility
* - `handlers/topic.ts`
  - `parseTopic(topic)` → `{ kind, serial?, accountId?, farmId?, gatewayId?, zoneId? }`. Recognises device‑id‑first + legacy forms; `kind ∈ {telemetry(zone), weather, health, state, cmd}`.
* - `handlers/resolve.ts`
  - `resolveDevice(serial)` → `{ accountId, farmId, gatewayId, zoneIds }` from the `gateways` binding (cached). Drops messages from unknown/unprovisioned serials.
* - `handlers/channels.ts`
  - `toDbChannelType(name)` (engine/loose name → DB `channel_type`) + `resolveZoneChannel` / `resolveFarmChannel` (cached `(zone|farm, type) → channel UUID`).
* - `handlers/telemetry.ts`
  - `handleZoneTelemetry` + `handleWeather`: extract readings (flat fields **or** a `readings[]` array), write `telemetry` rows, fan out live, derive actuator flags + a usage tick while irrigating.
* - `handlers/actuators.ts`
  - Reconcile reported actuator state (valve/pump/dosing) from `state` payloads.
* - `handlers/health.ts` / `handlers/liveness.ts`
  - Health heartbeats + online/offline detection: a quiet gateway flips to `offline` + raises an alert; the next message re‑arms `online`.
* - `handlers/publish.ts`
  - The Redis live‑bus publisher used by the telemetry/state handlers.
```

## 4. Serial → tenant + zone resolution (the crux)

Because devices are **device‑id‑first**, the worker never trusts IDs in the topic — it resolves
them:

1. `parseTopic` extracts the **serial** from `teranode/dev/{serial}/…`.
2. `resolveDevice(serial)` returns the bound `{accountId, farmId, gatewayId, zoneIds}` (the
   `zoneIds` are the farm's zones in creation order).
3. The device's **local 1‑based zone index** (`…/zone/1`) is mapped to `zoneIds[0]` — the real zone
   UUID — so the firmware never needs cloud IDs.
4. Each reading's channel name is normalised (`toDbChannelType`) and resolved to a `sensor_channels`
   UUID by `(zone|farm, type)`. Soil channels are zone‑level; weather/flow are farm‑level.

## 5. Two writes per reading

Every reading is written **durably** (a `telemetry` hypertable row, indexed by `(channel, time)`
and `(zone, time)`) **and** published **ephemerally** to Redis for the live UI. The two paths are
independent so the dashboard stays snappy without hammering Postgres. Usage ticks (litres while a
valve is open) land in `usage_events` for the savings analytics.

## 6. Liveness & alerts

`markSeen(gateway)` records the last‑seen time on every message. A periodic check flips a gateway
to `offline` after the threshold and writes an alert (`apps/api/src/services/alerts.ts` shares the
table); the next telemetry message re‑arms it. This is the source of the "Gateway offline" pill in
the apps.

## 7. Run

```bash
npm run -w @teranode/ingest start     # the worker (consumes MQTT → DB/Redis)
npm run -w @teranode/ingest virtual   # the virtual gateway (publishes for the seeded farm)
```

Needs `DATABASE_URL`, `REDIS_URL`, `MQTT_URL` (see {doc}`../components/infra`). The simulator side
is documented in {doc}`simulator`.
