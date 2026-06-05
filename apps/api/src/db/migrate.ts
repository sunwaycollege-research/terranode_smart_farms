// Idempotent raw-SQL migration for the full TERANODE schema (BUILD-SPEC §2).
//
// We deliberately use raw SQL (not drizzle-kit) because the schema needs
// TimescaleDB primitives that drizzle-kit cannot express: hypertables,
// continuous aggregates, and retention / compression policies.
//
// EVERYTHING here is written to tolerate re-runs:
//   - extensions: CREATE EXTENSION IF NOT EXISTS
//   - enums:      guarded by a DO $$ … EXCEPTION WHEN duplicate_object … $$ block
//   - tables/idx: CREATE TABLE/INDEX IF NOT EXISTS
//   - hypertables: create_hypertable(..., if_not_exists => TRUE)
//   - continuous aggregates: created WITH NO DATA, then refresh policies added
//     (add_continuous_aggregate_policy is wrapped so a duplicate is ignored)
//   - retention/compression policies: add_*_policy wrapped to ignore duplicates
//
// Run with:  npm run -w @teranode/api migrate

import 'dotenv/config';
import { Pool } from 'pg';

const DATABASE_URL =
  process.env.DATABASE_URL ??
  'postgres://teranode:teranode@localhost:5432/teranode';

/**
 * Wrap a Timescale policy / management call so that re-running the migration is
 * a no-op even when the policy already exists or the call is otherwise
 * idempotent-but-noisy. We swallow the common "already exists / duplicate"
 * conditions but re-raise anything unexpected.
 */
function ignoreDuplicate(call: string): string {
  return `DO $$ BEGIN
  ${call};
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN unique_violation THEN NULL;
  WHEN others THEN
    IF SQLERRM ILIKE '%already exists%' OR SQLERRM ILIKE '%already has%' OR SQLERRM ILIKE '%multiple%' THEN
      NULL;
    ELSE
      RAISE;
    END IF;
END $$;`;
}

// Each entry is one statement executed in order. Keeping them as discrete
// statements (rather than one giant string) makes failures easy to locate.
const STATEMENTS: string[] = [
  // --- extensions ------------------------------------------------------------
  `CREATE EXTENSION IF NOT EXISTS timescaledb`,
  `CREATE EXTENSION IF NOT EXISTS pgcrypto`,
  `CREATE EXTENSION IF NOT EXISTS citext`,

  // --- enums (guarded against duplicate_object) ------------------------------
  `DO $$ BEGIN CREATE TYPE account_type AS ENUM ('admin','customer'); EXCEPTION WHEN duplicate_object THEN NULL; END $$`,
  `DO $$ BEGIN CREATE TYPE account_status AS ENUM ('active','disabled'); EXCEPTION WHEN duplicate_object THEN NULL; END $$`,
  `DO $$ BEGIN CREATE TYPE user_role AS ENUM ('admin','customer'); EXCEPTION WHEN duplicate_object THEN NULL; END $$`,
  `DO $$ BEGIN CREATE TYPE compute_kind AS ENUM ('esp32','rpi4'); EXCEPTION WHEN duplicate_object THEN NULL; END $$`,
  `DO $$ BEGIN CREATE TYPE gw_status AS ENUM ('online','offline','unbound'); EXCEPTION WHEN duplicate_object THEN NULL; END $$`,
  `DO $$ BEGIN CREATE TYPE channel_type AS ENUM ('moisture','ph','ec','n','p','k','soiltemp','airtemp','humidity','pressure','rain'); EXCEPTION WHEN duplicate_object THEN NULL; END $$`,
  `DO $$ BEGIN CREATE TYPE alert_sev AS ENUM ('info','warn','critical'); EXCEPTION WHEN duplicate_object THEN NULL; END $$`,
  `DO $$ BEGIN CREATE TYPE actuator_scope AS ENUM ('zone','farm'); EXCEPTION WHEN duplicate_object THEN NULL; END $$`,
  `DO $$ BEGIN CREATE TYPE actuator_type AS ENUM ('valve','pump','dosing'); EXCEPTION WHEN duplicate_object THEN NULL; END $$`,

  // --- accounts & users ------------------------------------------------------
  `CREATE TABLE IF NOT EXISTS accounts (
     id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
     type account_type NOT NULL,
     name text NOT NULL,
     parent_id uuid REFERENCES accounts(id),
     status account_status NOT NULL DEFAULT 'active',
     plan text,
     locale text NOT NULL DEFAULT 'en',
     created_at timestamptz NOT NULL DEFAULT now(),
     updated_at timestamptz NOT NULL DEFAULT now()
   )`,
  `CREATE TABLE IF NOT EXISTS users (
     id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
     account_id uuid NOT NULL REFERENCES accounts(id),
     email citext UNIQUE NOT NULL,
     name text NOT NULL,
     role user_role NOT NULL,
     password_hash text NOT NULL,
     locale text,
     created_at timestamptz NOT NULL DEFAULT now()
   )`,

  // --- crops & growth stages -------------------------------------------------
  `CREATE TABLE IF NOT EXISTS crops (
     id text PRIMARY KEY,
     name_en text NOT NULL,
     name_ne text NOT NULL,
     emoji text NOT NULL,
     category text NOT NULL,
     days_to_harvest int NOT NULL,
     watering_notes_en text,
     watering_notes_ne text,
     ideal jsonb NOT NULL,
     acceptable jsonb NOT NULL,
     created_at timestamptz NOT NULL DEFAULT now()
   )`,
  `CREATE TABLE IF NOT EXISTS crop_stages (
     id text PRIMARY KEY,
     crop_id text NOT NULL REFERENCES crops(id),
     stage text NOT NULL,
     ordinal int NOT NULL,
     start_day int NOT NULL,
     ideal jsonb NOT NULL,
     acceptable jsonb NOT NULL,
     UNIQUE (crop_id, stage)
   )`,

  // --- farms, gateways, nodes, zones, channels -------------------------------
  `CREATE TABLE IF NOT EXISTS farms (
     id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
     account_id uuid NOT NULL REFERENCES accounts(id),
     name text NOT NULL,
     timezone text NOT NULL DEFAULT 'Asia/Kathmandu',
     geo jsonb,
     created_at timestamptz NOT NULL DEFAULT now()
   )`,
  `CREATE TABLE IF NOT EXISTS gateways (
     id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
     serial text UNIQUE NOT NULL,
     farm_id uuid REFERENCES farms(id),
     account_id uuid REFERENCES accounts(id),
     compute compute_kind NOT NULL DEFAULT 'esp32',
     fw_version text NOT NULL DEFAULT '0.0.0',
     status gw_status NOT NULL DEFAULT 'unbound',
     last_seen timestamptz,
     created_at timestamptz NOT NULL DEFAULT now()
   )`,
  `CREATE TABLE IF NOT EXISTS nodes (
     id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
     gateway_id uuid NOT NULL REFERENCES gateways(id),
     radio_addr text,
     battery int,
     last_seen timestamptz,
     created_at timestamptz NOT NULL DEFAULT now()
   )`,
  `CREATE TABLE IF NOT EXISTS zones (
     id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
     farm_id uuid NOT NULL REFERENCES farms(id),
     name text NOT NULL,
     crop_id text REFERENCES crops(id),
     planting_date date,
     area_m2 numeric,
     node_id uuid REFERENCES nodes(id),
     mode text NOT NULL DEFAULT 'auto',
     created_at timestamptz NOT NULL DEFAULT now()
   )`,
  `CREATE TABLE IF NOT EXISTS sensor_channels (
     id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
     zone_id uuid REFERENCES zones(id),
     farm_id uuid REFERENCES farms(id),
     type channel_type NOT NULL,
     unit text NOT NULL,
     calibration jsonb NOT NULL DEFAULT '{}',
     enabled boolean NOT NULL DEFAULT true
   )`,
  `CREATE TABLE IF NOT EXISTS device_tokens (
     id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
     gateway_id uuid NOT NULL REFERENCES gateways(id),
     secret_hash text NOT NULL,
     revoked boolean NOT NULL DEFAULT false,
     created_at timestamptz NOT NULL DEFAULT now()
   )`,

  // --- rules, schedules, dosing, actuators -----------------------------------
  `CREATE TABLE IF NOT EXISTS rules (
     zone_id uuid PRIMARY KEY REFERENCES zones(id),
     moisture_low numeric NOT NULL,
     moisture_high numeric NOT NULL,
     rain_skip_mm numeric NOT NULL DEFAULT 4,
     ph_target numeric,
     ec_target numeric,
     source text NOT NULL DEFAULT 'crop',
     applied_stage text,
     updated_at timestamptz NOT NULL DEFAULT now()
   )`,
  `CREATE TABLE IF NOT EXISTS schedules (
     id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
     farm_id uuid NOT NULL REFERENCES farms(id),
     window_start_hour int NOT NULL DEFAULT 5,
     window_end_hour int NOT NULL DEFAULT 19,
     et0_aware boolean NOT NULL DEFAULT true,
     max_run_min int NOT NULL DEFAULT 90,
     enabled boolean NOT NULL DEFAULT true
   )`,
  `CREATE TABLE IF NOT EXISTS dosing_profiles (
     farm_id uuid PRIMARY KEY REFERENCES farms(id),
     ec_target numeric NOT NULL,
     ph_target numeric NOT NULL,
     pumps jsonb NOT NULL DEFAULT '[]'
   )`,
  `CREATE TABLE IF NOT EXISTS actuators (
     id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
     scope actuator_scope NOT NULL,
     zone_id uuid REFERENCES zones(id),
     farm_id uuid REFERENCES farms(id),
     type actuator_type NOT NULL,
     state boolean NOT NULL DEFAULT false,
     desired boolean,
     mode text NOT NULL DEFAULT 'auto'
   )`,

  // --- telemetry + usage (hypertables) ---------------------------------------
  `CREATE TABLE IF NOT EXISTS telemetry (
     time timestamptz NOT NULL,
     channel_id uuid NOT NULL REFERENCES sensor_channels(id),
     zone_id uuid,
     farm_id uuid,
     value double precision NOT NULL,
     quality smallint NOT NULL DEFAULT 1
   )`,
  `SELECT create_hypertable('telemetry','time', chunk_time_interval => INTERVAL '1 day', if_not_exists => TRUE)`,
  `CREATE INDEX IF NOT EXISTS telemetry_channel_time ON telemetry (channel_id, time DESC)`,
  `CREATE INDEX IF NOT EXISTS telemetry_zone_time ON telemetry (zone_id, time DESC)`,
  `CREATE TABLE IF NOT EXISTS usage_events (
     time timestamptz NOT NULL,
     farm_id uuid NOT NULL,
     zone_id uuid,
     kind text NOT NULL,
     value double precision NOT NULL
   )`,
  `SELECT create_hypertable('usage_events','time', chunk_time_interval => INTERVAL '1 day', if_not_exists => TRUE)`,
  `CREATE INDEX IF NOT EXISTS usage_events_farm_time ON usage_events (farm_id, time DESC)`,

  // --- alerts, harvest, audit, catalog, entitlements -------------------------
  `CREATE TABLE IF NOT EXISTS alerts (
     id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
     account_id uuid NOT NULL REFERENCES accounts(id),
     farm_id uuid REFERENCES farms(id),
     zone_id uuid REFERENCES zones(id),
     severity alert_sev NOT NULL,
     type text NOT NULL,
     message_en text NOT NULL,
     message_ne text,
     ts timestamptz NOT NULL DEFAULT now(),
     acknowledged_at timestamptz
   )`,
  `CREATE TABLE IF NOT EXISTS harvest_log (
     id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
     zone_id uuid NOT NULL REFERENCES zones(id),
     crop_id text NOT NULL REFERENCES crops(id),
     harvested_at date NOT NULL,
     yield_kg numeric,
     notes text
   )`,
  `CREATE TABLE IF NOT EXISTS audit_log (
     id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
     actor_id uuid NOT NULL REFERENCES users(id),
     account_id uuid,
     action text NOT NULL,
     target text,
     before jsonb,
     after jsonb,
     ts timestamptz NOT NULL DEFAULT now()
   )`,
  `CREATE TABLE IF NOT EXISTS device_catalog (
     key text PRIMARY KEY,
     label text NOT NULL,
     category text NOT NULL,
     kind text NOT NULL,
     default_value jsonb NOT NULL,
     hint text,
     gates_dashboard boolean NOT NULL DEFAULT false
   )`,
  `CREATE TABLE IF NOT EXISTS entitlement_records (
     account_id uuid PRIMARY KEY REFERENCES accounts(id),
     values jsonb NOT NULL,
     updated_by uuid REFERENCES users(id),
     updated_at timestamptz NOT NULL DEFAULT now()
   )`,

  // --- continuous aggregates (WITH NO DATA) ----------------------------------
  // 5-minute rollup: avg/min/max per channel & zone.
  `CREATE MATERIALIZED VIEW IF NOT EXISTS telemetry_5m
   WITH (timescaledb.continuous) AS
     SELECT time_bucket(INTERVAL '5 minutes', time) AS bucket,
            channel_id,
            zone_id,
            avg(value) AS avg,
            min(value) AS min,
            max(value) AS max
       FROM telemetry
      GROUP BY bucket, channel_id, zone_id
   WITH NO DATA`,
  // 1-hour rollup.
  `CREATE MATERIALIZED VIEW IF NOT EXISTS telemetry_1h
   WITH (timescaledb.continuous) AS
     SELECT time_bucket(INTERVAL '1 hour', time) AS bucket,
            channel_id,
            zone_id,
            avg(value) AS avg,
            min(value) AS min,
            max(value) AS max
       FROM telemetry
      GROUP BY bucket, channel_id, zone_id
   WITH NO DATA`,
  // 1-day rollup.
  `CREATE MATERIALIZED VIEW IF NOT EXISTS telemetry_1d
   WITH (timescaledb.continuous) AS
     SELECT time_bucket(INTERVAL '1 day', time) AS bucket,
            channel_id,
            zone_id,
            avg(value) AS avg,
            min(value) AS min,
            max(value) AS max
       FROM telemetry
      GROUP BY bucket, channel_id, zone_id
   WITH NO DATA`,
  // daily usage rollup: sum per farm, zone, kind.
  `CREATE MATERIALIZED VIEW IF NOT EXISTS usage_1d
   WITH (timescaledb.continuous) AS
     SELECT time_bucket(INTERVAL '1 day', time) AS bucket,
            farm_id,
            zone_id,
            kind,
            sum(value) AS total
       FROM usage_events
      GROUP BY bucket, farm_id, zone_id, kind
   WITH NO DATA`,

  // --- continuous-aggregate refresh policies (idempotent) --------------------
  ignoreDuplicate(
    `PERFORM add_continuous_aggregate_policy('telemetry_5m',
        start_offset => INTERVAL '1 hour',
        end_offset => INTERVAL '5 minutes',
        schedule_interval => INTERVAL '5 minutes')`,
  ),
  ignoreDuplicate(
    `PERFORM add_continuous_aggregate_policy('telemetry_1h',
        start_offset => INTERVAL '3 days',
        end_offset => INTERVAL '1 hour',
        schedule_interval => INTERVAL '1 hour')`,
  ),
  ignoreDuplicate(
    `PERFORM add_continuous_aggregate_policy('telemetry_1d',
        start_offset => INTERVAL '30 days',
        end_offset => INTERVAL '1 day',
        schedule_interval => INTERVAL '1 hour')`,
  ),
  ignoreDuplicate(
    `PERFORM add_continuous_aggregate_policy('usage_1d',
        start_offset => INTERVAL '30 days',
        end_offset => INTERVAL '1 day',
        schedule_interval => INTERVAL '1 hour')`,
  ),

  // --- retention: drop telemetry older than 90 days --------------------------
  ignoreDuplicate(`PERFORM add_retention_policy('telemetry', INTERVAL '90 days')`),
  ignoreDuplicate(`PERFORM add_retention_policy('usage_events', INTERVAL '365 days')`),

  // --- compression: compress telemetry chunks older than 7 days --------------
  ignoreDuplicate(
    `ALTER TABLE telemetry SET (
        timescaledb.compress,
        timescaledb.compress_orderby = 'time DESC',
        timescaledb.compress_segmentby = 'channel_id')`,
  ),
  ignoreDuplicate(`PERFORM add_compression_policy('telemetry', INTERVAL '7 days')`),

  // --- device lifecycle deltas (idempotent; safe on existing databases) -------
  // New gateway statuses: 'claimed' (linked to a customer, pre-boot) + 'revoked'.
  `ALTER TYPE gw_status ADD VALUE IF NOT EXISTS 'claimed'`,
  `ALTER TYPE gw_status ADD VALUE IF NOT EXISTS 'revoked'`,
  // Inventory + provisioning columns on gateways.
  `ALTER TABLE gateways ADD COLUMN IF NOT EXISTS model text`,
  `ALTER TABLE gateways ADD COLUMN IF NOT EXISTS claimed_at timestamptz`,
  `ALTER TABLE gateways ADD COLUMN IF NOT EXISTS provisioned_at timestamptz`,
  `ALTER TABLE gateways ADD COLUMN IF NOT EXISTS wifi_ssid text`,
];

async function migrate(): Promise<void> {
  const pool = new Pool({ connectionString: DATABASE_URL });
  const client = await pool.connect();
  try {
    console.log(`[migrate] connected to ${redact(DATABASE_URL)}`);
    let i = 0;
    for (const stmt of STATEMENTS) {
      i += 1;
      const label = firstLine(stmt);
      try {
        await client.query(stmt);
        console.log(`[migrate] ok   (${i}/${STATEMENTS.length}) ${label}`);
      } catch (err) {
        console.error(`[migrate] FAIL (${i}/${STATEMENTS.length}) ${label}`);
        throw err;
      }
    }
    console.log('[migrate] complete — all statements applied (idempotent).');
  } finally {
    client.release();
    await pool.end();
  }
}

function firstLine(sql: string): string {
  const line = sql.trim().split('\n', 1)[0]?.trim() ?? '';
  return line.length > 80 ? `${line.slice(0, 77)}…` : line;
}

function redact(url: string): string {
  try {
    const u = new URL(url);
    if (u.password) u.password = '***';
    return u.toString();
  } catch {
    return url;
  }
}

migrate().catch((err) => {
  console.error('[migrate] error:', err);
  process.exit(1);
});
