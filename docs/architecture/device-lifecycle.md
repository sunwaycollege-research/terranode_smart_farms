# Device Lifecycle (Provisioning)

TERANODE uses a **device‑id‑first** model: a flashed gateway knows only its own
`{serial, secret}`. It phones home and the backend resolves everything else. This page is the
authoritative description of the device state machine and the provisioning handshake.

Canonical sources: `apps/api/src/routes/provision.ts`, `apps/api/src/services/provisioning.ts`,
`apps/api/src/services/customers.ts` (register/claim), `gateways` + `device_tokens` in
`apps/api/src/db/schema.ts`.

## 1. State machine

The `gateways.status` enum drives the lifecycle:

```{mermaid}
stateDiagram-v2
  [*] --> unbound: POST /admin/gateways (register)\nserial + hashed secret
  unbound --> claimed: POST /admin/devices/:serial/claim\n{ accountId }
  claimed --> online: POST /provision (secret OK)\nauto-create farm/zone/channels
  online --> offline: liveness timeout (ingest)
  offline --> online: next telemetry message
  claimed --> claimed: POST /provision before claim done → 202 pending (retry)
  unbound --> revoked: RMA / return
  claimed --> revoked
  online --> revoked
  revoked --> [*]
```

```{list-table}
:header-rows: 1
:widths: 16 22 62

* - Status
  - When
  - Meaning
* - `unbound`
  - After registration
  - Flashed + in inventory, `accountId = NULL`, `farmId = NULL`. Not yet sold.
* - `claimed`
  - After claim
  - Linked to a customer (`accountId` set) at purchase, but not yet booted (`farmId = NULL`).
* - `online`
  - After first boot + liveness
  - Provisioned (`farmId` set) and actively reporting; `last_seen` fresh.
* - `offline`
  - Liveness timeout
  - Was online; has gone quiet past the threshold. Auto re‑arms to `online` on the next message.
* - `revoked`
  - RMA / return / disable
  - Device secret rejected at `/provision`; no telemetry accepted.
```

## 2. The three operator actions

```{list-table}
:header-rows: 1
:widths: 26 30 44

* - Action
  - Endpoint
  - Effect
* - **Register** (manufacture)
  - `POST /admin/gateways { serial, model? }`
  - Creates a `gateways` row (`status=unbound`) + a `device_tokens` row holding a **bcrypt hash** of a `nanoid(40)` secret. The plaintext secret is returned **once** — it is what gets flashed alongside the serial.
* - **Claim** (purchase)
  - `POST /admin/devices/:serial/claim { accountId }`
  - Sets `accountId`, `status=claimed`, `claimedAt`. No farm required yet. The operator also sets the customer's entitlements (see {doc}`../reference/entitlements`).
* - **Delete** (RMA/cleanup)
  - `DELETE /admin/gateways/:id`
  - Removes the device + tokens + nodes; detaches zones (does not delete farm data).
```

## 3. The `/provision` handshake (device‑facing, no JWT)

On boot (and on every reconnect until linked), the device calls `POST /provision`:

```text
POST /provision
{ "serial": "TN-ESP32-0007", "secret": "<flashed secret>",
  "fwVersion": "1.0.0", "wifiSsid": "FarmWiFi",
  "capabilities": { "channels": ["moisture","soiltemp","ec","ph","n","p","k","airtemp","humidity","rain","flow"], "zones": 1, "pump": true } }
```

The backend (`provisioning.ts`):

1. **Authenticates** the device: looks up the gateway by `serial`, then verifies `secret` against
   the non‑revoked `device_tokens` via bcrypt. Unknown serial → 404; bad secret → 401; revoked → 403.
2. If the gateway has **no `accountId`** (not yet claimed) → returns `202 { status: "pending",
   retryAfterSec: 30 }`. The device waits and retries.
3. If **claimed but no `farmId`** (first boot) → **auto‑provisions** in one transaction:
   a default farm named after the customer, a `Zone 1`, and `sensor_channels` derived from the
   reported `capabilities.channels` (zone‑level soil channels + farm‑level weather/flow). Sets
   `farmId`, `status=online`, `provisionedAt`.
4. Returns `200 { status:"linked", accountId, farmId, gatewayId, mqttUrl, mqttUsername=serial,
   topicPrefix:"teranode/dev/<serial>" }`.

The device caches its identity in NVS and begins publishing to `topicPrefix/telemetry/…`.

:::{note}
**Channel mapping:** zone‑level channels are `moisture, ph, ec, n, p, k, soiltemp`; farm‑level
channels are `airtemp, humidity, pressure, rain, flow`. The device declares what it has; the
backend creates the matching `sensor_channels`, then the ingest worker resolves the device's local
`zone/1` index to the created zone. See {doc}`../reference/data-model`.
:::

## 4. Auto‑show & self‑service

Because the farmer is already signed into the claimed account, the app's `/live` WebSocket surfaces
the new farm + readings **with no manual pairing**. From there the farmer can:

- **Onboard more devices** — the mobile *Add a device* flow walks through power‑on + WiFi (SoftAP)
  and polls until the device links.
- **Create zones** — capped by the `zoneNodes` entitlement (how many sensor nodes they bought);
  the farmer picks a crop from the admin crop library and the zone is linked to its node.

## 5. Hardware‑free testing

The whole lifecycle is exercisable without hardware via the **device simulator**
(`apps/ingest/src/virtual/device-sim.ts`): it calls `/provision` with a seeded `serial+secret`,
then streams device‑id‑first telemetry — bringing a claimed device "online" exactly as real
firmware would. See {doc}`../components/simulator`.
