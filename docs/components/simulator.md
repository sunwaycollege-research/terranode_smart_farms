# Simulators (Hardware‑Free)

TERANODE can be run and demoed end‑to‑end **without any hardware**. There are three simulators,
each at a different layer.

```{list-table}
:header-rows: 1
:widths: 26 22 52

* - Simulator
  - Layer
  - Use it to…
* - **Device simulator** `apps/ingest/src/virtual/device-sim.ts`
  - device‑id‑first
  - Bring a *claimed* device "online" exactly like real firmware: `POST /provision` then stream device‑id MQTT telemetry. Best for testing the full provisioning + live path.
* - **Virtual gateway** `apps/ingest/src/virtual/index.ts`
  - legacy triple
  - Drive the *seeded* farm with drifting telemetry (legacy `account/farm/gateway` topics). Quick way to see the demo farm move.
* - **Browser digital twin** `simulator/teranode-twin.html`
  - visualisation
  - An animated SVG field + control logic that needs **no backend** — for product demos / control‑logic illustration.
```

## 1. Device simulator (recommended)

`device-sim.ts` is a faithful stand‑in for `firmware/teranode_gateway`: it phones home and streams
the same 7‑in‑1 soil + DHT22 + rain + flow telemetry, running the same moisture‑hysteresis loop.

```{mermaid}
sequenceDiagram
  participant SIM as device-sim.ts
  participant API as API
  participant MQ as Mosquitto
  participant IN as Ingest
  SIM->>API: POST /provision { serial, secret, capabilities }
  API-->>SIM: { topicPrefix, farmId } (retries while pending)
  loop every TICK_MS
    SIM->>SIM: hysteresis valve + moisture drift + channel jitter
    SIM->>MQ: telemetry/zone/1 + telemetry/weather + state + health
    MQ->>IN: deliver → telemetry rows + live bus
  end
```

Run it (the device must already be **registered + claimed** — see
{doc}`../architecture/device-lifecycle`):

```bash
SERIAL=TN-ESP32-BHUWAN SECRET=<device-secret> \
API_BASE=http://localhost:4000 MQTT_URL=mqtt://localhost:1883 \
npx tsx apps/ingest/src/virtual/device-sim.ts
```

It publishes the **device‑id‑first** topics, so the ingest worker resolves `serial → farm` and
maps `zone/1` to the auto‑provisioned zone — the farmer's app then shows live, drifting data with
no hardware.

## 2. Virtual gateway

`virtual/index.ts` loads the seeded customer farm and publishes drifting per‑zone telemetry +
a health heartbeat on the legacy `teranode/{account}/{farm}/{gateway}/…` topics. The drift core is
a pure module (`virtual/drift.ts`): moisture rises while a valve is open, falls while closed, with
hysteresis valve control and jittered secondary channels — so the whole stack moves realistically.

```bash
npm run -w @teranode/ingest virtual
```

## 3. Browser digital twin

`simulator/teranode-twin.html` (and a themed variant) render an interactive field with live
gauges and the irrigation control logic in the browser — **no backend required**. Useful for
explaining the product and the control loop without standing up the stack. See `docs/SIMULATIONS.md`.

## 4. Which one to use

```{list-table}
:header-rows: 1
:widths: 40 60

* - Goal
  - Pick
* - Demo a *specific* customer/device + the provisioning flow
  - **device‑sim** (claim a device, then run it)
* - Just see the seeded demo farm move
  - **virtual gateway**
* - Explain the concept with zero setup
  - **browser digital twin**
```

All three avoid hardware; the device‑sim is the closest to production because it uses the same
`/provision` + device‑id‑first MQTT contract the real firmware uses ({doc}`firmware`).
