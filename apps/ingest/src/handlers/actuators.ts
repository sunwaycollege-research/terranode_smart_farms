// Actuator state upserts driven by telemetry/state reports.
//
// The seed does not pre-create actuator rows; the ingest worker is the first
// thing that knows a zone's valve is open or a farm's pump is running. So we
// get-or-create the actuator row for a (scope, owner, type) and then set its
// reported `state`. We publish a WsStateMessage whenever the state changes.
//
// Rows are cached by (scope:owner:type) → actuator row so we avoid a lookup
// per tick; the cached `state`/`desired` lets us skip no-op publishes.

import type Redis from 'ioredis';
import { query } from '../db';
import { publishLive } from './publish';

type Scope = 'zone' | 'farm';
type ActType = 'valve' | 'pump' | 'dosing';

type ActuatorRow = {
  id: string;
  scope: Scope;
  zone_id: string | null;
  farm_id: string | null;
  type: ActType;
  state: boolean;
  desired: boolean | null;
  mode: string;
};

const cache = new Map<string, ActuatorRow>();

function cacheKey(scope: Scope, owner: string, type: ActType): string {
  return `${scope}:${owner}:${type}`;
}

/** Get-or-create the actuator row for a zone (scope=zone) or farm (scope=farm). */
async function getOrCreate(
  scope: Scope,
  owner: string,
  farmId: string,
  type: ActType,
): Promise<ActuatorRow | null> {
  const key = cacheKey(scope, owner, type);
  const cached = cache.get(key);
  if (cached) return cached;

  const ownerCol = scope === 'zone' ? 'zone_id' : 'farm_id';
  const existing = await query<ActuatorRow>(
    `SELECT id, scope, zone_id, farm_id, type, state, desired, mode
       FROM actuators
       WHERE scope = $1::actuator_scope AND ${ownerCol} = $2 AND type = $3::actuator_type
       LIMIT 1`,
    [scope, owner, type],
  );
  if (existing[0]) {
    cache.set(key, existing[0]);
    return existing[0];
  }

  const zoneId = scope === 'zone' ? owner : null;
  const inserted = await query<ActuatorRow>(
    `INSERT INTO actuators (scope, zone_id, farm_id, type, state, mode)
     VALUES ($1::actuator_scope, $2, $3, $4::actuator_type, false, 'auto')
     RETURNING id, scope, zone_id, farm_id, type, state, desired, mode`,
    [scope, zoneId, farmId, type],
  );
  const row = inserted[0] ?? null;
  if (row) cache.set(key, row);
  return row;
}

/**
 * Set the reported `state` of a zone's valve (and publish on change). Returns
 * the actuator id so callers can correlate.
 */
export async function setZoneValveState(
  redis: Redis,
  zoneId: string,
  farmId: string,
  state: boolean,
): Promise<string | null> {
  return setState(redis, 'zone', zoneId, farmId, 'valve', state, zoneId);
}

/** Set the reported `state` of the farm pump (and publish on change). */
export async function setFarmPumpState(
  redis: Redis,
  farmId: string,
  state: boolean,
): Promise<string | null> {
  return setState(redis, 'farm', farmId, farmId, 'pump', state, null);
}

/** Set the reported `state` of the farm dosing actuator (and publish on change). */
export async function setFarmDosingState(
  redis: Redis,
  farmId: string,
  state: boolean,
): Promise<string | null> {
  return setState(redis, 'farm', farmId, farmId, 'dosing', state, null);
}

async function setState(
  redis: Redis,
  scope: Scope,
  owner: string,
  farmId: string,
  type: ActType,
  state: boolean,
  zoneIdForMsg: string | null,
): Promise<string | null> {
  const row = await getOrCreate(scope, owner, farmId, type);
  if (!row) return null;

  if (row.state === state) return row.id; // no change → no write, no publish

  await query(`UPDATE actuators SET state = $1 WHERE id = $2`, [state, row.id]);
  row.state = state;

  await publishLive(redis, {
    type: 'state',
    farmId,
    zoneId: zoneIdForMsg,
    actuatorId: row.id,
    state,
    desired: row.desired ?? null,
    ts: new Date().toISOString(),
  });

  return row.id;
}

/** Directly upsert a reported actuator state by actuator id (state-topic path). */
export async function reportActuatorById(
  redis: Redis,
  actuatorId: string,
  state: boolean,
): Promise<void> {
  const rows = await query<ActuatorRow>(
    `SELECT id, scope, zone_id, farm_id, type, state, desired, mode
       FROM actuators WHERE id = $1 LIMIT 1`,
    [actuatorId],
  );
  const row = rows[0];
  if (!row) return;
  if (row.state === state) return;

  await query(`UPDATE actuators SET state = $1 WHERE id = $2`, [state, actuatorId]);

  // resolve farmId for the message (zone actuators carry only zone_id)
  let farmId = row.farm_id;
  if (!farmId && row.zone_id) {
    const fr = await query<{ farm_id: string }>(
      `SELECT farm_id FROM zones WHERE id = $1 LIMIT 1`,
      [row.zone_id],
    );
    farmId = fr[0]?.farm_id ?? null;
  }

  if (!farmId) return;

  await publishLive(redis, {
    type: 'state',
    farmId,
    zoneId: row.zone_id,
    actuatorId,
    state,
    desired: row.desired ?? null,
    ts: new Date().toISOString(),
  });
}
