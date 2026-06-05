// Startup loader for the virtual gateway.
//
// Reads the seeded tenant graph straight from Postgres so the simulator knows
// *what* to simulate: the (first) customer farm, its account_id + online
// gateway, every zone with its mode + moisture hysteresis rule, and the latest
// known moisture per zone (falling back to a sensible seeded start when the
// telemetry hypertable is empty — which it is on a fresh seed).
//
// We use a thin `pg` Pool here rather than drizzle: the virtual gateway is a
// standalone process that only needs a handful of read-only queries at boot.

import { Pool } from 'pg';
import type { ZoneRule, ZoneSimState } from './drift';

const DATABASE_URL =
  process.env.DATABASE_URL ??
  'postgres://teranode:teranode@localhost:5433/teranode';

/** The simulated gateway's identity + the zones it owns. */
export interface FarmContext {
  accountId: string;
  farmId: string;
  gatewayId: string;
  serial: string;
  fwVersion: string;
  zones: ZoneSimState[];
}

interface FarmRow {
  account_id: string;
  farm_id: string;
  gateway_id: string;
  serial: string;
  fw_version: string;
}

interface ZoneRow {
  id: string;
  crop_id: string | null;
  mode: string;
  moisture_low: string | number | null;
  moisture_high: string | number | null;
}

/** A middle-of-band seeded start for moisture when no telemetry exists yet. */
function seedMoisture(rule: ZoneRule): number {
  const mid = (rule.moistureLow + rule.moistureHigh) / 2;
  return Math.round(mid * 10) / 10;
}

/**
 * Load the first online (or any) customer gateway + its farm + zones + rules.
 * Throws if no suitable farm/gateway is seeded.
 */
export async function loadFarmContext(): Promise<FarmContext> {
  const pool = new Pool({ connectionString: DATABASE_URL });
  try {
    // pick a customer farm that has a gateway, preferring an online one.
    const farmRes = await pool.query<FarmRow>(
      `SELECT a.id  AS account_id,
              f.id  AS farm_id,
              g.id  AS gateway_id,
              g.serial,
              g.fw_version
         FROM accounts a
         JOIN farms f    ON f.account_id = a.id
         JOIN gateways g ON g.farm_id = f.id
        WHERE a.type = 'customer'
        ORDER BY (g.status = 'online') DESC, f.created_at ASC, g.created_at ASC
        LIMIT 1`,
    );
    const farm = farmRes.rows[0];
    if (!farm) {
      throw new Error(
        'virtual gateway: no seeded customer farm+gateway found — run `npm run -w @teranode/api seed` first',
      );
    }

    const zoneRes = await pool.query<ZoneRow>(
      `SELECT z.id,
              z.crop_id,
              z.mode,
              r.moisture_low,
              r.moisture_high
         FROM zones z
         LEFT JOIN rules r ON r.zone_id = z.id
        WHERE z.farm_id = $1
        ORDER BY z.name ASC`,
      [farm.farm_id],
    );

    const zones: ZoneSimState[] = [];
    for (const row of zoneRes.rows) {
      // Default thresholds if a zone somehow has no rule yet.
      const low = row.moisture_low != null ? Number(row.moisture_low) : 55;
      const high = row.moisture_high != null ? Number(row.moisture_high) : 75;
      const rule: ZoneRule = { moistureLow: low, moistureHigh: high };

      const moisture = await latestMoisture(pool, row.id, rule);

      zones.push({
        zoneId: row.id,
        cropId: row.crop_id,
        mode: row.mode ?? 'auto',
        rule,
        moisture,
        // start every valve closed; the first tick will open it if dry.
        valve: false,
        // plausible per-zone baselines for the secondary channels.
        ph: 6.4,
        ec: 2.0,
        n: 120,
        p: 50,
        k: 180,
        soilTemp: 21,
      });
    }

    if (zones.length === 0) {
      throw new Error(
        `virtual gateway: farm ${farm.farm_id} has no zones to simulate`,
      );
    }

    return {
      accountId: farm.account_id,
      farmId: farm.farm_id,
      gatewayId: farm.gateway_id,
      serial: farm.serial,
      fwVersion: farm.fw_version,
      zones,
    };
  } finally {
    await pool.end();
  }
}

/**
 * Latest persisted moisture for a zone (most-recent telemetry value on a
 * moisture channel). Falls back to a mid-band seeded value when the hypertable
 * is empty (fresh seed) or has no moisture rows for this zone.
 */
async function latestMoisture(
  pool: Pool,
  zoneId: string,
  rule: ZoneRule,
): Promise<number> {
  const res = await pool.query<{ value: number }>(
    `SELECT t.value
       FROM telemetry t
       JOIN sensor_channels sc ON sc.id = t.channel_id
      WHERE t.zone_id = $1
        AND sc.type = 'moisture'
      ORDER BY t.time DESC
      LIMIT 1`,
    [zoneId],
  );
  const v = res.rows[0]?.value;
  if (typeof v === 'number' && Number.isFinite(v)) {
    return Math.round(v * 10) / 10;
  }
  return seedMoisture(rule);
}
