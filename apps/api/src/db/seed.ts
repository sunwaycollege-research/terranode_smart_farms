// Parity seed (BUILD-SPEC §2). Idempotent: re-running upserts the reference data
// (crops, crop_stages, device_catalog) and only creates the demo tenant graph
// (admin + customer + farm + gateway + zones + channels + rules + entitlements)
// when it is not already present.
//
// Run with:  npm run -w @teranode/api seed   (after `migrate`).
//
// The demo zones get planting dates computed as offsets from the DB clock so that
// each crop sits in a meaningful growth stage:
//   Zone 1 = tomato     (~65 days ago → fruiting)
//   Zone 2 = capsicum   (~45 days ago → flowering)
//   Zone 3 = spinach    (~12 days ago → vegetative)

import 'dotenv/config';
import { Pool, type PoolClient } from 'pg';
import bcrypt from 'bcryptjs';
import {
  CROPS,
  currentStage,
  deriveRule,
  getCrop,
} from '@teranode/agronomy';
import type { Crop, GrowthStage } from '@teranode/types';
import { DEVICE_CATALOG, defaultEntitlements } from '@teranode/types';

const DATABASE_URL =
  process.env.DATABASE_URL ??
  'postgres://teranode:teranode@localhost:5432/teranode';

const PASSWORD = 'teranode';

/** Per-zone seed plan: crop + days-since-planting + sensor channels to attach. */
interface ZonePlan {
  name: string;
  cropId: string;
  daysAgo: number;
  areaM2: number;
}

const ZONE_PLANS: ZonePlan[] = [
  { name: 'Zone 1 — Tomato', cropId: 'tomato', daysAgo: 65, areaM2: 200 },
  { name: 'Zone 2 — Capsicum', cropId: 'capsicum', daysAgo: 45, areaM2: 150 },
  { name: 'Zone 3 — Spinach', cropId: 'spinach', daysAgo: 12, areaM2: 120 },
];

/** Soil/zone sensor channels created per zone (DB channel_type + unit). */
const ZONE_CHANNELS: { type: string; unit: string }[] = [
  { type: 'moisture', unit: '%' },
  { type: 'ph', unit: 'pH' },
  { type: 'ec', unit: 'mS/cm' },
  { type: 'n', unit: 'mg/kg' },
  { type: 'p', unit: 'mg/kg' },
  { type: 'k', unit: 'mg/kg' },
  { type: 'soiltemp', unit: '°C' },
];

/** Farm-level weather-mast + flow channels. */
const FARM_WEATHER_CHANNELS: { type: string; unit: string }[] = [
  { type: 'airtemp', unit: '°C' },
  { type: 'humidity', unit: '%' },
  { type: 'pressure', unit: 'hPa' },
  { type: 'rain', unit: 'mm' },
  { type: 'flow', unit: 'L/min' }, // YF-S201 flow meter — leak detection + usage
];

// --- reference data (idempotent upserts) -------------------------------------

async function seedCrops(client: PoolClient): Promise<void> {
  for (const crop of CROPS) {
    await client.query(
      `INSERT INTO crops
         (id, name_en, name_ne, emoji, category, days_to_harvest,
          watering_notes_en, watering_notes_ne, ideal, acceptable)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       ON CONFLICT (id) DO UPDATE SET
         name_en = EXCLUDED.name_en,
         name_ne = EXCLUDED.name_ne,
         emoji = EXCLUDED.emoji,
         category = EXCLUDED.category,
         days_to_harvest = EXCLUDED.days_to_harvest,
         watering_notes_en = EXCLUDED.watering_notes_en,
         watering_notes_ne = EXCLUDED.watering_notes_ne,
         ideal = EXCLUDED.ideal,
         acceptable = EXCLUDED.acceptable`,
      [
        crop.id,
        crop.nameEn,
        crop.nameNe,
        crop.emoji,
        crop.category,
        crop.daysToHarvest,
        crop.wateringNotesEn,
        crop.wateringNotesNe,
        JSON.stringify(crop.ideal),
        JSON.stringify(crop.acceptable),
      ],
    );

    for (const stage of crop.stages) {
      const stageId = `${crop.id}:${stage.stage}`;
      await client.query(
        `INSERT INTO crop_stages
           (id, crop_id, stage, ordinal, start_day, ideal, acceptable)
         VALUES ($1,$2,$3,$4,$5,$6,$7)
         ON CONFLICT (id) DO UPDATE SET
           crop_id = EXCLUDED.crop_id,
           stage = EXCLUDED.stage,
           ordinal = EXCLUDED.ordinal,
           start_day = EXCLUDED.start_day,
           ideal = EXCLUDED.ideal,
           acceptable = EXCLUDED.acceptable`,
        [
          stageId,
          crop.id,
          stage.stage,
          stage.ordinal,
          stage.startDay,
          JSON.stringify(stage.ideal),
          JSON.stringify(stage.acceptable),
        ],
      );
    }
  }
  console.log(`[seed] crops: ${CROPS.length} crops + stages upserted`);
}

async function seedDeviceCatalog(client: PoolClient): Promise<void> {
  for (const item of DEVICE_CATALOG) {
    await client.query(
      `INSERT INTO device_catalog
         (key, label, category, kind, default_value, hint, gates_dashboard)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT (key) DO UPDATE SET
         label = EXCLUDED.label,
         category = EXCLUDED.category,
         kind = EXCLUDED.kind,
         default_value = EXCLUDED.default_value,
         hint = EXCLUDED.hint,
         gates_dashboard = EXCLUDED.gates_dashboard`,
      [
        item.key,
        item.label,
        item.category,
        item.kind,
        JSON.stringify(item.defaultValue),
        item.hint,
        item.gatesDashboard,
      ],
    );
  }
  console.log(`[seed] device_catalog: ${DEVICE_CATALOG.length} modules upserted`);
}

// --- demo tenant graph -------------------------------------------------------

/** Upsert an account by (type,name) and return its id. */
async function upsertAccount(
  client: PoolClient,
  type: 'admin' | 'customer',
  name: string,
  parentId: string | null,
  plan: string | null,
): Promise<string> {
  const existing = await client.query<{ id: string }>(
    `SELECT id FROM accounts WHERE type = $1 AND name = $2 LIMIT 1`,
    [type, name],
  );
  if (existing.rows[0]) return existing.rows[0].id;
  const inserted = await client.query<{ id: string }>(
    `INSERT INTO accounts (type, name, parent_id, status, plan)
     VALUES ($1,$2,$3,'active',$4) RETURNING id`,
    [type, name, parentId, plan],
  );
  return inserted.rows[0].id;
}

/** Upsert a user by email and return its id. */
async function upsertUser(
  client: PoolClient,
  accountId: string,
  email: string,
  name: string,
  role: 'admin' | 'customer',
  passwordHash: string,
): Promise<string> {
  const inserted = await client.query<{ id: string }>(
    `INSERT INTO users (account_id, email, name, role, password_hash)
     VALUES ($1,$2,$3,$4,$5)
     ON CONFLICT (email) DO UPDATE SET
       account_id = EXCLUDED.account_id,
       name = EXCLUDED.name,
       role = EXCLUDED.role,
       password_hash = EXCLUDED.password_hash
     RETURNING id`,
    [accountId, email, name, role, passwordHash],
  );
  return inserted.rows[0].id;
}

async function seedTenant(client: PoolClient): Promise<void> {
  const passwordHash = await bcrypt.hash(PASSWORD, 10);

  // admin root + admin user --------------------------------------------------
  const adminAccountId = await upsertAccount(
    client,
    'admin',
    'TERANODE',
    null,
    'platform',
  );
  const adminUserId = await upsertUser(
    client,
    adminAccountId,
    'admin@teranode.io',
    'TERANODE Admin',
    'admin',
    passwordHash,
  );

  // customer account + user --------------------------------------------------
  const customerAccountId = await upsertAccount(
    client,
    'customer',
    'Green Valley Farm',
    adminAccountId,
    'pro',
  );
  await upsertUser(
    client,
    customerAccountId,
    'farmer@greenvalley.np',
    'Green Valley Farmer',
    'customer',
    passwordHash,
  );

  console.log('[seed] accounts/users: admin root + customer ready');

  // entitlements for the customer -------------------------------------------
  await client.query(
    `INSERT INTO entitlement_records (account_id, values, updated_by)
     VALUES ($1,$2,$3)
     ON CONFLICT (account_id) DO UPDATE SET
       values = EXCLUDED.values,
       updated_by = EXCLUDED.updated_by,
       updated_at = now()`,
    [customerAccountId, JSON.stringify(defaultEntitlements()), adminUserId],
  );
  console.log('[seed] entitlement_records: customer entitlements set');

  // farm ---------------------------------------------------------------------
  const farm = await getOrCreateFarm(client, customerAccountId, 'Green Valley Farm');

  // gateway (online) + a node ------------------------------------------------
  const gatewayId = await getOrCreateGateway(
    client,
    'TN-ESP32-0001',
    farm,
    customerAccountId,
  );
  const nodeId = await getOrCreateNode(client, gatewayId);

  // demo provisioning devices (device-id-first lifecycle) --------------------
  // In-stock: registered/flashed but not sold → POST /provision returns 'pending'.
  await seedProvisioningDevice(client, 'TN-ESP32-STOCK', {
    accountId: null,
    secret: 'stock-secret-demo',
    model: 'TN-BRAIN-3Z',
  });
  // Claimed: linked to the customer, not yet booted → first /provision auto-
  // creates a default farm + zone + channels. Secret is known for testing.
  await seedProvisioningDevice(client, 'TN-ESP32-DEMO', {
    accountId: customerAccountId,
    secret: 'demo-secret-123',
    model: 'TN-BRAIN-3Z',
  });
  console.log('[seed] provisioning demo devices: TN-ESP32-STOCK (in_stock), TN-ESP32-DEMO (claimed)');

  // farm weather channels (idempotent by farm_id + type) ---------------------
  for (const ch of FARM_WEATHER_CHANNELS) {
    await getOrCreateChannel(client, { farmId: farm, type: ch.type, unit: ch.unit });
  }

  // zones + soil channels + rules -------------------------------------------
  for (const plan of ZONE_PLANS) {
    const crop = getCrop(plan.cropId);
    if (!crop) {
      console.warn(`[seed] skipping zone ${plan.name}: unknown crop ${plan.cropId}`);
      continue;
    }
    const zoneId = await getOrCreateZone(client, farm, nodeId, plan);

    for (const ch of ZONE_CHANNELS) {
      await getOrCreateChannel(client, { zoneId, farmId: farm, type: ch.type, unit: ch.unit });
    }

    await seedZoneRule(client, zoneId, crop, plan.daysAgo);
  }

  console.log(`[seed] tenant graph: farm + gateway + ${ZONE_PLANS.length} zones ready`);
}

async function getOrCreateFarm(
  client: PoolClient,
  accountId: string,
  name: string,
): Promise<string> {
  const existing = await client.query<{ id: string }>(
    `SELECT id FROM farms WHERE account_id = $1 AND name = $2 LIMIT 1`,
    [accountId, name],
  );
  if (existing.rows[0]) return existing.rows[0].id;
  const inserted = await client.query<{ id: string }>(
    `INSERT INTO farms (account_id, name, timezone, geo)
     VALUES ($1,$2,'Asia/Kathmandu',$3) RETURNING id`,
    [accountId, name, JSON.stringify({ lat: 27.6711, lng: 85.4298 })],
  );
  return inserted.rows[0].id;
}

async function getOrCreateGateway(
  client: PoolClient,
  serial: string,
  farmId: string,
  accountId: string,
): Promise<string> {
  const inserted = await client.query<{ id: string }>(
    `INSERT INTO gateways (serial, farm_id, account_id, compute, fw_version, status, last_seen)
     VALUES ($1,$2,$3,'esp32','1.2.0','online', now())
     ON CONFLICT (serial) DO UPDATE SET
       farm_id = EXCLUDED.farm_id,
       account_id = EXCLUDED.account_id,
       status = 'online',
       last_seen = now()
     RETURNING id`,
    [serial, farmId, accountId],
  );
  return inserted.rows[0].id;
}

/**
 * Seed a device in the provisioning lifecycle (non-destructive + idempotent):
 * create the gateway (unbound or claimed) + one device token whose hash matches
 * the given plaintext secret, so /provision can be exercised with a known secret.
 */
async function seedProvisioningDevice(
  client: PoolClient,
  serial: string,
  opts: { accountId: string | null; secret: string; model: string },
): Promise<void> {
  const existing = await client.query<{ id: string }>(
    `SELECT id FROM gateways WHERE serial = $1 LIMIT 1`,
    [serial],
  );
  let gatewayId: string;
  if (existing.rows[0]) {
    gatewayId = existing.rows[0].id;
  } else {
    const inserted = await client.query<{ id: string }>(
      `INSERT INTO gateways (serial, account_id, compute, model, status, claimed_at)
       VALUES ($1,$2,'esp32',$3,$4::gw_status,$5) RETURNING id`,
      [
        serial,
        opts.accountId,
        opts.model,
        opts.accountId ? 'claimed' : 'unbound',
        opts.accountId ? new Date() : null,
      ],
    );
    gatewayId = inserted.rows[0].id;
  }
  const tok = await client.query<{ id: string }>(
    `SELECT id FROM device_tokens WHERE gateway_id = $1 AND revoked = false LIMIT 1`,
    [gatewayId],
  );
  if (!tok.rows[0]) {
    const hash = await bcrypt.hash(opts.secret, 10);
    await client.query(`INSERT INTO device_tokens (gateway_id, secret_hash) VALUES ($1,$2)`, [
      gatewayId,
      hash,
    ]);
  }
}

async function getOrCreateNode(client: PoolClient, gatewayId: string): Promise<string> {
  const existing = await client.query<{ id: string }>(
    `SELECT id FROM nodes WHERE gateway_id = $1 LIMIT 1`,
    [gatewayId],
  );
  if (existing.rows[0]) return existing.rows[0].id;
  const inserted = await client.query<{ id: string }>(
    `INSERT INTO nodes (gateway_id, radio_addr, battery, last_seen)
     VALUES ($1,'0x01',98, now()) RETURNING id`,
    [gatewayId],
  );
  return inserted.rows[0].id;
}

async function getOrCreateZone(
  client: PoolClient,
  farmId: string,
  nodeId: string,
  plan: ZonePlan,
): Promise<string> {
  const existing = await client.query<{ id: string }>(
    `SELECT id FROM zones WHERE farm_id = $1 AND name = $2 LIMIT 1`,
    [farmId, plan.name],
  );
  if (existing.rows[0]) {
    // keep planting date fresh relative to "now" so the demo stage stays correct.
    await client.query(
      `UPDATE zones
          SET crop_id = $2,
              planting_date = (now() - ($3 || ' days')::interval)::date,
              area_m2 = $4,
              node_id = $5
        WHERE id = $1`,
      [existing.rows[0].id, plan.cropId, String(plan.daysAgo), plan.areaM2, nodeId],
    );
    return existing.rows[0].id;
  }
  const inserted = await client.query<{ id: string }>(
    `INSERT INTO zones (farm_id, name, crop_id, planting_date, area_m2, node_id, mode)
     VALUES ($1,$2,$3,(now() - ($4 || ' days')::interval)::date,$5,$6,'auto')
     RETURNING id`,
    [farmId, plan.name, plan.cropId, String(plan.daysAgo), plan.areaM2, nodeId],
  );
  return inserted.rows[0].id;
}

async function getOrCreateChannel(
  client: PoolClient,
  args: { zoneId?: string; farmId: string; type: string; unit: string },
): Promise<void> {
  const { zoneId = null, farmId, type, unit } = args;
  const existing = await client.query<{ id: string }>(
    zoneId
      ? `SELECT id FROM sensor_channels WHERE zone_id = $1 AND type = $2 LIMIT 1`
      : `SELECT id FROM sensor_channels WHERE farm_id = $1 AND zone_id IS NULL AND type = $2 LIMIT 1`,
    zoneId ? [zoneId, type] : [farmId, type],
  );
  if (existing.rows[0]) return;
  await client.query(
    `INSERT INTO sensor_channels (zone_id, farm_id, type, unit, calibration, enabled)
     VALUES ($1,$2,$3::channel_type,$4,'{}'::jsonb,true)`,
    [zoneId, farmId, type, unit],
  );
}

/** Derive and upsert the crop-driven rule for a zone from its current stage. */
async function seedZoneRule(
  client: PoolClient,
  zoneId: string,
  crop: Crop,
  daysAgo: number,
): Promise<void> {
  // Reconstruct the same planting instant the DB used (now - daysAgo days).
  const now = new Date();
  const plantingDate = new Date(now.getTime() - daysAgo * 86_400_000);
  const stageResult = currentStage(crop, plantingDate, now);
  const stage: GrowthStage = stageResult.stage;
  const rule = deriveRule(crop, stageResult.def);

  await client.query(
    `INSERT INTO rules
       (zone_id, moisture_low, moisture_high, rain_skip_mm, ph_target, ec_target, source, applied_stage)
     VALUES ($1,$2,$3,4,$4,$5,'crop',$6)
     ON CONFLICT (zone_id) DO UPDATE SET
       moisture_low = EXCLUDED.moisture_low,
       moisture_high = EXCLUDED.moisture_high,
       ph_target = EXCLUDED.ph_target,
       ec_target = EXCLUDED.ec_target,
       source = 'crop',
       applied_stage = EXCLUDED.applied_stage,
       updated_at = now()`,
    [
      zoneId,
      rule.moistureLow,
      rule.moistureHigh,
      rule.phTarget,
      rule.ecTarget,
      stage,
    ],
  );
}

// --- entrypoint --------------------------------------------------------------

async function seed(): Promise<void> {
  const pool = new Pool({ connectionString: DATABASE_URL });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await seedCrops(client);
    await seedDeviceCatalog(client);
    await seedTenant(client);
    await client.query('COMMIT');
    console.log('[seed] complete.');
    console.log('[seed] login: admin@teranode.io / farmer@greenvalley.np  (password: teranode)');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

seed().catch((err) => {
  console.error('[seed] error:', err);
  process.exit(1);
});
