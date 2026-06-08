# Shared Packages

Two workspace packages are the contract glue + the domain brain. They are pure, deterministic
TypeScript imported by the API, ingest, web, and mobile — so the shapes and the agronomy logic
can't drift between client and server.

## 1. `@teranode/types`

The single source of truth for every shape that crosses a boundary.

```{list-table}
:header-rows: 1
:widths: 22 78

* - File
  - Contents
* - `entities.ts`
  - DB/domain entities: `Account`, `User`, `Farm`, `Gateway`, `Node`, `Zone`, `ZoneWithCrop`, `Actuator`, `Alert`, `Rule`, `Crop`, `Telemetry*`, `DeviceCatalogItem`, `Entitlements`, `UUID`, `GeoJson`, `FarmReading`, … (timestamps as ISO strings).
* - `dto.ts`
  - Request/response DTOs for the REST surface: `LoginRequest/Response`, `FleetResponse`, `CreateZoneRequest/Response`, `ZoneAnalysisResponse`, `FarmReadingsResponse`, `AuthTokens`, etc.
* - `enums.ts`
  - String‑literal unions mirroring the Postgres enums: `AccountType`, `UserRole`, `GatewayStatus`, `ChannelType` (incl. `flow`), `ActuatorType`, `AlertSeverity`, … + runtime arrays for validation.
* - `agronomy.ts`
  - Agronomy types: `Channel`, `CropBand`, `GrowthStage`, `CropStageDef`, `ZoneAnalysis`, `Recommendation`, `HealthResult`, `ChannelStatus`, `DerivedRule`.
* - `mqtt.ts`
  - MQTT topic builders + payload interfaces (telemetry/weather/health/state/cmd). See {doc}`../reference/mqtt-topics`.
* - `ws.ts`
  - The `/live` WebSocket event shapes.
* - `catalog.ts`
  - The canonical `DEVICE_CATALOG` (9 modules) + `defaultEntitlements()`. See {doc}`../reference/entitlements`.
```

## 2. `@teranode/agronomy`

The crop‑driven engine: pure functions over crop bands that turn raw readings into a stage, a
health score, target bands, recommendations, and a fertilizer plan. Fully unit‑tested.

```
packages/agronomy/src/
├── crops/        14+ crops (tomato, potato, onion, garlic, chili, cauliflower, cabbage,
│                 cucumber, carrot, spinach, beans, lettuce, eggplant, capsicum, okra, …)
│                 each with per-stage ideal/acceptable bands; + bands.ts, builder.ts, index.ts
└── engine/
    ├── stage.ts       currentStage(crop, plantingDate) → growth stage + days
    ├── status.ts      evaluateChannels → per-channel below/in/above vs the stage band
    ├── health.ts      channelScore + zoneHealth → 0–100 score
    ├── rules.ts       deriveRule(crop, stage) → moisture low/high, pH/EC targets
    ├── recommend.ts   recommendations(...) → bilingual coaching cards + actions
    ├── analyze.ts     analyzeZone(...) → the full ZoneAnalysis (stage+health+channels+recs+rule)
    └── fertilizer.ts  fertilizerPlan(cropId, stage) / fertilizerSchedule(cropId) (TNAU/JICA/NAST)
```

### Key functions

```{list-table}
:header-rows: 1
:widths: 30 70

* - Function
  - Purpose
* - `currentStage(crop, plantingDate)`
  - Map days‑since‑planting → `germination | vegetative | flowering | fruiting | harvest`.
* - `analyzeZone(input)`
  - The cornerstone: returns `{ stage, daysSincePlanting, health, channels[], recommendations[], rule }`. Used by the API's `/zones/:id/analysis`.
* - `zoneHealth(statuses)`
  - 0–100 health score from per‑channel deviations.
* - `recommendations(crop, stage, statuses)`
  - Deterministic bilingual coaching (e.g. `moisture below → irrigate`, `ph above → ph_down`).
* - `fertilizerPlan(cropId, stage)` / `fertilizerSchedule(cropId)`
  - Stage‑aware fertiliser dose + organic option, sourced from cited research (`docs/RESEARCH.md`). Surfaced identically in web + mobile.
```

### Why a shared engine

```{mermaid}
flowchart LR
  CROPS["crop bands"] --> ENG["agronomy engine"]
  READ["sensor readings"] --> ENG
  ENG --> A["analyzeZone → API /analysis"]
  ENG --> F["fertilizerPlan → web + mobile cards"]
  ENG --> R["recommendations → coach / alerts"]
```

Because the engine is pure + deterministic + shared, the API's zone analysis, the mobile coach
cards, and the web crop library all compute the **same** answer from the **same** crop data — no
divergence, and it's covered by the agronomy test suite.

## 3. Conventions

- Extensionless TS imports; no new runtime deps without cause (see `docs/BUILD-SPEC.md`).
- Types live **only** in `@teranode/types`; the agronomy engine re‑exports the agronomy types for
  convenience but never redefines them.
- Everything typechecks across the monorepo (`npm run -w @teranode/<pkg> typecheck`); the agronomy
  package ships a vitest suite (`npm run -w @teranode/agronomy test`).
```
