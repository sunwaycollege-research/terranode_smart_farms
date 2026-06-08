# Data Model (Postgres / TimescaleDB)

The durable system of record. Typed surface: `apps/api/src/db/schema.ts` (Drizzle). DDL +
hypertables/aggregates/policies: `apps/api/src/db/migrate.ts`. Entity shapes:
`packages/types/src/entities.ts`.

## 1. Entity‑relationship diagram

```{mermaid}
erDiagram
  accounts ||--o{ users : "owns"
  accounts ||--o{ farms : "owns"
  accounts ||--o{ gateways : "claims"
  accounts ||--|| entitlement_records : "has"
  accounts ||--o{ alerts : ""
  farms ||--o{ zones : "has"
  farms ||--o{ gateways : "bound"
  farms ||--o{ schedules : ""
  farms ||--|| dosing_profiles : ""
  farms ||--o{ sensor_channels : "weather/flow"
  gateways ||--o{ nodes : "radio"
  gateways ||--o{ device_tokens : "secret"
  zones ||--o| rules : "1:1"
  zones ||--o{ sensor_channels : "soil"
  zones ||--o{ actuators : "valve"
  zones }o--|| crops : "planted"
  zones ||--o{ harvest_log : ""
  nodes ||--o{ zones : "wireless"
  sensor_channels ||--o{ telemetry : "readings"
  crops ||--o{ crop_stages : "stages"
  users ||--o{ audit_log : "actor"
```

## 2. Tables

```{list-table}
:header-rows: 1
:widths: 22 78

* - Table
  - Purpose / key columns
* - **accounts**
  - tenants. `type (admin|customer)`, `name`, `parent_id`, `status`, `plan`, `locale`.
* - **users**
  - logins. `account_id`, `email (citext, unique)`, `role`, `password_hash`.
* - **crops** / **crop_stages**
  - crop library (slug id, EN/NE names, emoji, category, `days_to_harvest`, `ideal`/`acceptable` bands jsonb) + per‑stage bands.
* - **farms**
  - `account_id`, `name`, `timezone`, `geo` (GeoJSON).
* - **gateways**
  - the ESP32 brain. `serial (unique)`, `account_id?`, `farm_id?`, `compute`, `model`, `fw_version`, `status` (lifecycle), `claimed_at`, `provisioned_at`, `wifi_ssid`, `last_seen`.
* - **device_tokens**
  - `gateway_id`, `secret_hash (bcrypt)`, `revoked` — device auth at `/provision`.
* - **nodes**
  - per‑gateway radio sensor nodes. `gateway_id`, `radio_addr`, `battery`, `last_seen`.
* - **zones**
  - `farm_id`, `name`, `crop_id?`, `planting_date?`, `area_m2?`, `node_id?`, `mode (auto|manual)`.
* - **sensor_channels**
  - a measurable channel on a zone OR a farm. `(zone_id|farm_id)`, `type (channel_type)`, `unit`, `calibration` jsonb, `enabled`.
* - **rules**
  - per‑zone irrigation rule (PK = `zone_id`). `moisture_low/high`, `rain_skip_mm`, `ph_target?`, `ec_target?`, `source (crop|manual)`, `applied_stage`.
* - **schedules**
  - per‑farm irrigation window. `window_start/end_hour`, `et0_aware`, `max_run_min`, `enabled`.
* - **dosing_profiles**
  - per‑farm fertigation (PK = `farm_id`). `ec_target`, `ph_target`, `pumps` jsonb.
* - **actuators**
  - `scope (zone|farm)`, `zone_id?`, `farm_id?`, `type (valve|pump|dosing)`, `state`, `desired`, `mode`.
* - **telemetry** ⏱
  - **hypertable**. `time`, `channel_id`, `zone_id?`, `farm_id?`, `value`, `quality`. Indexed `(channel,time)` + `(zone,time)`.
* - **usage_events** ⏱
  - **hypertable**. `time`, `farm_id`, `zone_id?`, `kind`, `value` (e.g. `water_liters`).
* - **alerts**
  - `account_id`, `farm_id?`, `zone_id?`, `severity`, `type`, `message_en/ne`, `ts`, `acknowledged_at?`.
* - **harvest_log**
  - `zone_id`, `crop_id`, `harvested_at`, `yield_kg?`, `notes?`.
* - **audit_log**
  - `actor_id (user)`, `account_id?`, `action`, `target`, `before`/`after` jsonb, `ts`.
* - **device_catalog**
  - the 9 entitlement modules (key, label, category, kind, default, hint, `gates_dashboard`).
* - **entitlement_records**
  - per‑account feature flags (PK = `account_id`). `values` jsonb, `updated_by`, `updated_at`.
```

## 3. Enums

```{list-table}
:header-rows: 1
:widths: 24 76

* - Enum
  - Values
* - `account_type` / `user_role`
  - `admin · customer`
* - `account_status`
  - `active · disabled`
* - `compute_kind`
  - `esp32 · rpi4`
* - `gw_status`
  - `online · offline · unbound · claimed · revoked` (device lifecycle)
* - `channel_type`
  - `moisture · ph · ec · n · p · k · soiltemp · airtemp · humidity · pressure · rain · flow`
* - `alert_sev`
  - `info · warn · critical`
* - `actuator_scope` / `actuator_type`
  - `zone · farm` / `valve · pump · dosing`
```

## 4. TimescaleDB specifics

`migrate.ts` is idempotent raw SQL. Beyond the tables it:

- enables `timescaledb`, `pgcrypto`, `citext`;
- converts **`telemetry`** and **`usage_events`** into **hypertables** (time‑partitioned);
- creates **continuous aggregates** (rollups, e.g. 5‑minute / hourly / daily) that power
  `GET /zones/:id/telemetry?agg=` and the analytics without scanning raw rows;
- adds **retention + compression policies** so old raw data is compressed/expired automatically.

## 5. Notes

- **Multi‑tenancy** is by `account_id` on the roots (`accounts → farms/gateways`); ownership of a
  zone/channel is resolved by walking up to the account (see {doc}`../architecture/security`).
- **jsonb** is used where the logical shape is owned by `@teranode/types`/`@teranode/agronomy`
  (`crops.ideal`, `entitlement_records.values`, `dosing_profiles.pumps`, audit `before/after`).
- **Seeding** (`seed.ts`) loads the 14 crops + stages, the device catalog, and an admin + demo
  customer/farm so a fresh DB is immediately usable.
```
