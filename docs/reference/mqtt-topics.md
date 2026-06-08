# MQTT Topic Reference

The device ⇄ cloud contract. Canonical sources: `packages/types/src/mqtt.ts` (builders + payload
shapes), `apps/ingest/src/handlers/topic.ts` (parser), `apps/ingest/src/index.ts` (subscriptions).

Root namespace: **`teranode`**.

## 1. Two topic families

```{list-table}
:header-rows: 1
:widths: 20 44 36

* - Family
  - Shape
  - Used by
* - **Device‑id‑first** (preferred)
  - `teranode/dev/{serial}/{kind}/…`
  - Real firmware + the device simulator. The device knows only its serial; ingest resolves the rest.
* - **Legacy explicit‑triple**
  - `teranode/{accountId}/{farmId}/{gatewayId}/{kind}/…`
  - The virtual gateway + older flows. Still parsed.
```

`kind ∈ { telemetry, weather, health, state, cmd }`.

## 2. Topics

```{list-table}
:header-rows: 1
:widths: 30 14 12 44

* - Topic (device‑id‑first)
  - Dir
  - Retain
  - Payload
* - `teranode/dev/{serial}/telemetry/zone/{n}`
  - pub
  - no
  - per‑zone soil readings (`n` = local 1‑based zone index)
* - `teranode/dev/{serial}/telemetry/weather`
  - pub
  - no
  - farm‑level weather + flow
* - `teranode/dev/{serial}/telemetry/gateway/health`
  - pub
  - **yes**
  - online/offline heartbeat + fw/battery (also the LWT)
* - `teranode/dev/{serial}/state/zone/{n}`
  - pub
  - **yes**
  - reported actuator state (valve/pump)
* - `teranode/dev/{serial}/cmd/gateway/config`
  - sub
  - **yes**
  - the per‑zone rule (moisture low/high, rain‑skip, window) pushed by the cloud
* - `teranode/dev/{serial}/cmd/zone/{n}/valve`
  - sub
  - no
  - manual valve override
```

Ingest subscribes to: `teranode/dev/+/telemetry/zone/+`, `…/telemetry/weather`,
`…/telemetry/gateway/health`, `…/state/#`.

## 3. Payloads

From `packages/types/src/mqtt.ts`. A reading is `{ channel, value, quality? }`; the firmware also
sends flat convenience fields which the ingest worker accepts equivalently.

```js
// telemetry/zone/{n}
{ "ts": "2026-06-07T10:15:00Z", "zoneId": "1",
  "readings": [ { "channel": "moisture", "value": 44.8, "quality": 1 },
                { "channel": "soiltemp", "value": 21.4 }, { "channel": "ec", "value": 1.98 },
                { "channel": "ph", "value": 6.5 }, { "channel": "n", "value": 92 },
                { "channel": "p", "value": 42 }, { "channel": "k", "value": 192 } ],
  "valve": true, "pump": true, "mode": "auto" }

// telemetry/weather  (farm-level channels)
{ "ts": "…", "readings": [ { "channel": "airtemp", "value": 27.3 },
  { "channel": "humidity", "value": 58.5 }, { "channel": "rain", "value": 0 },
  { "channel": "flow", "value": 11.2 } ] }

// telemetry/gateway/health  (retained; also the Last-Will)
{ "ts": "…", "status": "online", "fwVersion": "1.0.0", "battery": 87 }

// state/zone/{n}  (retained — reported actuator state)
{ "ts": "…", "actuators": [ { "actuatorId": "<uuid>", "zoneId": "<uuid>", "state": true } ],
  "usage": [ { "zoneId": "<uuid>", "kind": "water_liters", "value": 0.4 } ] }

// cmd  (server → gateway)
{ "ts": "…", "actuatorId": "<uuid>", "zoneId": "<uuid>", "action": "open", "volumeMl": 0 }
```

`action ∈ { open, close, on, off, dose }`.

## 4. Channel types

The `channel` strings map to the DB `channel_type` enum (see {doc}`data-model`):

> `moisture · ph · ec · n · p · k · soiltemp` (zone‑level) ·
> `airtemp · humidity · pressure · rain · flow` (farm‑level)

The ingest worker normalises loose/engine names (e.g. `soilTemp` → `soiltemp`) via
`toDbChannelType` and resolves each to a `sensor_channels` UUID before writing.

## 5. Resolution rules (ingest)

1. `parseTopic` extracts `kind` + `serial` (or the legacy triple).
2. `resolveDevice(serial)` → `{ accountId, farmId, gatewayId, zoneIds }` (cached).
3. The device's local `zone/{n}` index maps to `zoneIds[n-1]` (the real zone UUID).
4. Each reading's channel → `sensor_channels` UUID by `(zone|farm, type)`; weather/flow are
   farm‑level (no zone).
5. A row is written to `telemetry` **and** published to the Redis live bus.

See {doc}`../architecture/data-flow` for the full sequence.
