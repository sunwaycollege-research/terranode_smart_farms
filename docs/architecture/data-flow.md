# End‑to‑End Data Flow

This page traces a reading from the soil to the farmer's phone, a command from the phone back to
the valve, and how the system stays live in real time. The contracts referenced here are pinned
in {doc}`../reference/mqtt-topics`, {doc}`../reference/rest-api`, and {doc}`../reference/data-model`.

## 1. Telemetry: soil → phone

```{mermaid}
sequenceDiagram
  autonumber
  participant FW as ESP32 Gateway
  participant MQ as Mosquitto
  participant IN as Ingest worker
  participant DB as TimescaleDB
  participant RD as Redis
  participant API as Express API (/live WS)
  participant APP as Web / Mobile

  FW->>FW: read 7-in-1 soil + DHT22 + rain + flow
  FW->>MQ: publish teranode/dev/{serial}/telemetry/zone/1 {moisture, ph, ec, n, p, k, soilTemp, valve, pump}
  FW->>MQ: publish .../telemetry/weather {airTemp, humidity, rain, flow}
  MQ->>IN: deliver (subscribed teranode/dev/+/telemetry/#)
  IN->>IN: parseTopic → serial; resolveDevice(serial) → {accountId, farmId, gatewayId, zoneIds}
  IN->>IN: map local zone index "1" → real zone UUID; key → channel UUID
  IN->>DB: INSERT telemetry rows (hypertable)
  IN->>RD: publish live { farmId, zoneId, channel, value, ts }
  IN->>IN: markSeen(gateway) — re-arm liveness
  APP->>API: WebSocket /live (subscribe to the account's farms)
  RD-->>API: live message
  API-->>APP: push reading
  Note over APP: dashboard tile / gauge updates in ~seconds
```

Key points:

- **Device‑id‑first topics.** The device publishes to `teranode/dev/{serial}/…` knowing only its
  serial. The ingest worker resolves the serial to `{accountId, farmId, gatewayId, zoneIds}`
  (cached), and maps the device's **local 1‑based zone index** to the real zone UUID — so the
  firmware never needs to know cloud IDs. (A legacy `teranode/{accountId}/{farmId}/{gatewayId}/…`
  form is also accepted.) See `apps/ingest/src/handlers/topic.ts` and `apps/ingest/src/index.ts`.
- **Channel resolution.** Each numeric reading maps to a `sensor_channels` row by
  `(zone_id|farm_id, type)`; the resolved channel UUID is what's written to `telemetry`. Weather/
  flow are **farm‑level** channels (no zone); soil channels are **zone‑level**.
- **Two writes per reading.** Durable (TimescaleDB hypertable, for history/analytics) **and**
  ephemeral (Redis, for the live UI). The API's `/live` WebSocket subscribes to Redis and pushes
  to the apps that are watching that account's farms.
- **EC units.** The probe reports EC in µS/cm; it is normalised to **mS/cm** to match the agronomy
  bands (see {doc}`../components/firmware` and `RESEARCH.md`).

## 2. Control: phone → valve (desired‑vs‑reported)

Actuation is **eventually consistent**: the app sets a *desired* state, the device reports its
*reported* state, and the UI shows "pending" while they differ.

```{mermaid}
sequenceDiagram
  autonumber
  participant APP as Mobile / Web
  participant API as Express API
  participant DB as Postgres
  participant MQ as Mosquitto
  participant FW as ESP32 Gateway
  participant IN as Ingest

  APP->>API: POST /zones/:id/valve { open: true }
  API->>DB: resolve/create the zone's valve actuator; set desired=true, state=true (pre-MQTT optimistic)
  API->>MQ: publish retained cmd (server → gateway)
  API-->>APP: { actuator, pending }
  MQ->>FW: deliver command (or device reads retained config on reconnect)
  FW->>FW: drive relay (pump + solenoid)
  FW->>MQ: publish .../state/zone/1 { valve, pump } (retained)
  MQ->>IN: deliver state
  IN->>DB: update actuator reported state; emit usage tick while open
  IN->>RD: publish live state
  Note over APP: pending clears when reported == desired
```

The same pattern powers **auto mode**: the edge control loop opens/closes the valve from the
moisture rule; the cloud only pushes the *rule* (low/high thresholds, rain‑skip, window) as a
retained config message, and the device keeps running it offline.

## 3. Provisioning: factory → live

A claimed device coming online auto‑creates its farm and starts streaming with **no manual
pairing**. Full state machine in {doc}`device-lifecycle`.

```{mermaid}
sequenceDiagram
  autonumber
  participant OP as Operator (web)
  participant API as API
  participant FW as ESP32 (in the field)
  participant DB as Postgres

  OP->>API: POST /admin/gateways { serial } → device secret (shown once)
  Note over OP,FW: serial + secret are flashed onto the device
  OP->>API: POST /admin/devices/:serial/claim { accountId }  (gateway.status = claimed)
  FW->>API: POST /provision { serial, secret, capabilities }
  alt not yet claimed
    API-->>FW: 202 { status: "pending" } → device retries every 30s
  else claimed
    API->>DB: auto-create farm + Zone 1 + sensor_channels from capabilities; status = online
    API-->>FW: 200 { accountId, farmId, gatewayId, mqttUrl, topicPrefix }
    FW->>FW: cache identity (NVS) → start telemetry on teranode/dev/{serial}/…
  end
```

## 4. Liveness & alerts

The ingest worker tracks the last time each gateway was *seen*. If a gateway goes quiet past the
threshold, ingest flips `gateways.status` to `offline` and raises an alert; the next message
re‑arms it to `online`. The agronomy engine also emits **coaching recommendations** (e.g. "moisture
low → irrigate", "pH high → lower it") that surface as alerts/coach cards. Sources:
`apps/ingest/src/handlers/liveness.ts`, `apps/api/src/services/alerts.ts`.

## 5. Why this shape

```{list-table}
:header-rows: 1
:widths: 32 68

* - Concern
  - How the data flow addresses it
* - Field connectivity is unreliable
  - Control runs at the edge; the cloud path is best‑effort. Retained MQTT config means a device picks up the latest rule on reconnect.
* - Real‑time UX without hammering the DB
  - Redis carries the live bus; the durable write and the live push are independent.
* - Devices shouldn't hold tenant secrets
  - Device‑id‑first: the device knows only its serial+secret; the cloud owns the `serial → tenant` mapping.
* - High‑volume time series
  - TimescaleDB hypertables + continuous aggregates (see {doc}`../reference/data-model`).
```
