# TERANODE Engineering Documentation

**TERANODE** is a crop‑driven smart **irrigation + fertigation** IoT platform for smallholder
vegetable farms. A solar‑powered **ESP32 field gateway** reads a 7‑in‑1 soil probe, weather,
and flow; runs an **edge irrigation control loop**; and streams telemetry over **MQTT** to a
cloud that turns raw readings into **crop‑aware, bilingual guidance** for farmers and a fleet
console for the operator.

This site documents how **every** part fits together — firmware, infrastructure, the ingest
worker + simulator, the API, the web admin panel, the mobile farmer app, and the shared
agronomy/types packages — plus the integration contracts (MQTT, REST, database, entitlements,
auth) and how to run and deploy it.

```{mermaid}
flowchart LR
  subgraph Field["🌾 Field"]
    FW["ESP32 Gateway<br/>(firmware)"]
    S7["7-in-1 RS485 soil probe<br/>DHT22 · rain · YF-S201 flow"]
    ACT["Relay → pump + valve"]
    S7 --> FW
    FW --> ACT
  end
  subgraph Cloud["☁️ Cloud (Docker)"]
    MQ["Mosquitto<br/>MQTT broker"]
    IN["Ingest worker"]
    DB[("TimescaleDB")]
    RD[("Redis<br/>live bus")]
    API["Express API<br/>REST + WebSocket"]
    MQ --> IN --> DB
    IN --> RD
    DB --> API
    RD --> API
  end
  subgraph Apps["📱 Clients"]
    WEB["Web admin<br/>(operator)"]
    MOB["Mobile app<br/>(farmer)"]
  end
  FW -- "telemetry / state" --> MQ
  API -- "cmd (retained)" --> MQ -- "cmd" --> FW
  FW -. "POST /provision" .-> API
  API --> WEB
  API --> MOB
```

::::{grid} 1 2 2 3
:gutter: 3

:::{grid-item-card} 🏛 Architecture
:link: architecture/overview
:link-type: doc
System context, end‑to‑end data flow, the device lifecycle, and the security model.
:::

:::{grid-item-card} 🧩 Components
:link: components/api
:link-type: doc
Deep dives: firmware, infra, API, ingest, simulator, web, mobile, shared packages.
:::

:::{grid-item-card} 📐 Reference (Contracts)
:link: reference/mqtt-topics
:link-type: doc
MQTT topics, REST API, database schema, entitlements, firmware API reference.
:::

:::{grid-item-card} 🛠 Operations
:link: operations/run-guide
:link-type: doc
Run it locally, deploy to production, and rebuild this documentation.
:::

:::{grid-item-card} 🔌 Firmware API
:link: reference/firmware-api
:link-type: doc
Auto‑generated (Doxygen) reference for the ESP32 firmware functions + structures.
:::

:::{grid-item-card} 📚 Project & Product
:link: PROJECT-OVERVIEW
:link-type: doc
The original strategy, hardware/BOM, roadmap, research, and go‑to‑market docs.
:::

::::

```{toctree}
:caption: Architecture
:maxdepth: 2
:hidden:

architecture/overview
architecture/data-flow
architecture/device-lifecycle
architecture/security
```

```{toctree}
:caption: Components
:maxdepth: 2
:hidden:

components/firmware
components/infra
components/api
components/ingest
components/simulator
components/web
components/mobile
components/packages
```

```{toctree}
:caption: Reference (Contracts)
:maxdepth: 2
:hidden:

reference/mqtt-topics
reference/rest-api
reference/data-model
reference/entitlements
reference/firmware-api
```

```{toctree}
:caption: Operations
:maxdepth: 2
:hidden:

operations/run-guide
operations/deployment
operations/build-docs
```

```{toctree}
:caption: Project & Product
:maxdepth: 1
:hidden:

PROJECT-OVERVIEW
01-System-Architecture
02-IoT-Hardware-and-Firmware
03-Web-and-Mobile-App
04-Roadmap-and-Phased-Plan
05-BOM-and-Cost
06-Field-Deployment-and-Ops
07-Business-and-GTM
BUILD-SPEC
DEVELOPMENT-PLAN
RESEARCH
SIMULATIONS
OVERNIGHT-SUMMARY
```
