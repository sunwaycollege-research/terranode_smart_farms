// Gateway health + actuator-state report handling.
//
// health topic payload (MqttHealthPayload): { ts, status, fwVersion?, battery? }
//   - status 'online'  → mark gateway online, bump last_seen + fw_version
//   - status 'offline' → an explicit LWT/offline → markOffline (alert + status)
//
// state topic payload (MqttStatePayload): { ts, actuators:[{actuatorId,zoneId?,
//   state}], usage?:[{zoneId?,kind,value}] } — reconcile reported actuator
//   state into the DB and record any usage ticks. An empty/offline state with a
//   `status:'offline'` field is treated as an LWT too.

import type Redis from 'ioredis';
import type { MqttHealthPayload, MqttStatePayload } from '@teranode/types';
import { query } from '../db';
import { markOnline, markOffline } from './liveness';
import { reportActuatorById } from './actuators';
import type { ParsedTopic } from './topic';

export async function handleHealth(
  redis: Redis,
  parsed: ParsedTopic,
  payload: Record<string, unknown>,
): Promise<{ status: string } | null> {
  const gatewayId = parsed.gatewayId;
  if (!gatewayId) return null;

  const status = typeof payload.status === 'string' ? payload.status : 'online';

  if (status === 'offline') {
    await markOffline(redis, gatewayId, {
      accountId: parsed.accountId,
      farmId: parsed.farmId,
    });
    return { status: 'offline' };
  }

  // online: bump last_seen + optional fw_version/battery
  await markOnline(gatewayId);
  const fw = (payload as unknown as MqttHealthPayload).fwVersion;
  if (typeof fw === 'string' && fw.length > 0) {
    await query(`UPDATE gateways SET fw_version = $1 WHERE id = $2`, [fw, gatewayId]);
  }
  const battery = (payload as unknown as MqttHealthPayload).battery;
  if (typeof battery === 'number' && Number.isFinite(battery)) {
    await query(
      `UPDATE nodes SET battery = $1, last_seen = now()
         WHERE gateway_id = $2`,
      [Math.round(battery), gatewayId],
    );
  }
  return { status: 'online' };
}

export async function handleState(
  redis: Redis,
  parsed: ParsedTopic,
  payload: Record<string, unknown>,
): Promise<{ actuators: number; usage: number } | null> {
  const gatewayId = parsed.gatewayId;

  // An LWT delivered on a state topic (offline) → offline alert.
  if (typeof payload.status === 'string' && payload.status === 'offline' && gatewayId) {
    await markOffline(redis, gatewayId, {
      accountId: parsed.accountId,
      farmId: parsed.farmId,
    });
    return { actuators: 0, usage: 0 };
  }

  const sp = payload as unknown as MqttStatePayload;
  let actuatorCount = 0;
  if (Array.isArray(sp.actuators)) {
    for (const a of sp.actuators) {
      if (!a || typeof a.actuatorId !== 'string' || typeof a.state !== 'boolean') continue;
      await reportActuatorById(redis, a.actuatorId, a.state);
      actuatorCount += 1;
    }
  }

  let usageCount = 0;
  if (Array.isArray(sp.usage) && parsed.farmId) {
    for (const u of sp.usage) {
      if (!u || typeof u.value !== 'number' || !Number.isFinite(u.value)) continue;
      const kind = typeof u.kind === 'string' && u.kind ? u.kind : 'water_liters';
      await query(
        `INSERT INTO usage_events (time, farm_id, zone_id, kind, value)
         VALUES (now(), $1, $2, $3, $4)`,
        [parsed.farmId, u.zoneId ?? null, kind, u.value],
      );
      usageCount += 1;
    }
  }

  return { actuators: actuatorCount, usage: usageCount };
}
