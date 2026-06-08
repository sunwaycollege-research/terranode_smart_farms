// sensor_channels resolution + small in-process cache.
//
// Telemetry payloads carry engine-ish channel names (moisture, ph, soilTemp…);
// the DB stores raw channel_type values (moisture, ph, soiltemp…). We normalize
// the incoming name to the DB type via CHANNEL_DB_MAP (engine→db) and a few
// extra aliases (humidity/pressure/rain have no engine name), then look up the
// sensor_channels row for that (zone_id|farm_id, type).
//
// channel ids are stable per (zone,type) so we cache them for the worker
// lifetime; a miss falls through to the DB.

import { CHANNEL_DB_MAP } from '@teranode/types';
import { query } from '../db';

/** Engine/loose channel name → raw DB channel_type. Returns null if unknown. */
export function toDbChannelType(name: string): string | null {
  const key = name.trim();
  // direct engine-name mapping (moisture, soilTemp → soiltemp, …)
  if (key in CHANNEL_DB_MAP) {
    return CHANNEL_DB_MAP[key as keyof typeof CHANNEL_DB_MAP];
  }
  // tolerant lowercase aliases (the DB enum values + the spec's flat field names)
  const lower = key.toLowerCase();
  const aliases: Record<string, string> = {
    moisture: 'moisture',
    ph: 'ph',
    ec: 'ec',
    n: 'n',
    p: 'p',
    k: 'k',
    soiltemp: 'soiltemp',
    soil_temp: 'soiltemp',
    airtemp: 'airtemp',
    air_temp: 'airtemp',
    temp: 'airtemp',
    temperature: 'airtemp',
    humidity: 'humidity',
    pressure: 'pressure',
    rain: 'rain',
    rainfall: 'rain',
    flow: 'flow',
    flowlpm: 'flow',
    flow_lpm: 'flow',
  };
  return aliases[lower] ?? null;
}

const zoneCache = new Map<string, string | null>(); // `${zoneId}:${type}` → channelId
const farmCache = new Map<string, string | null>(); // `${farmId}:${type}` → channelId

/** Resolve the sensor_channels.id for a zone's channel type (cached). */
export async function resolveZoneChannel(
  zoneId: string,
  dbType: string,
): Promise<string | null> {
  const cacheKey = `${zoneId}:${dbType}`;
  const cached = zoneCache.get(cacheKey);
  if (cached !== undefined) return cached;

  const rows = await query<{ id: string }>(
    `SELECT id FROM sensor_channels
       WHERE zone_id = $1 AND type = $2::channel_type AND enabled = true
       LIMIT 1`,
    [zoneId, dbType],
  );
  const id = rows[0]?.id ?? null;
  zoneCache.set(cacheKey, id);
  return id;
}

/** Resolve the farm-level sensor_channels.id for a channel type (cached). */
export async function resolveFarmChannel(
  farmId: string,
  dbType: string,
): Promise<string | null> {
  const cacheKey = `${farmId}:${dbType}`;
  const cached = farmCache.get(cacheKey);
  if (cached !== undefined) return cached;

  const rows = await query<{ id: string }>(
    `SELECT id FROM sensor_channels
       WHERE farm_id = $1 AND zone_id IS NULL AND type = $2::channel_type AND enabled = true
       LIMIT 1`,
    [farmId, dbType],
  );
  const id = rows[0]?.id ?? null;
  farmCache.set(cacheKey, id);
  return id;
}

/** Resolve the farm_id for a zone (cached) — telemetry rows want both ids. */
const zoneFarmCache = new Map<string, string | null>();
export async function resolveZoneFarm(zoneId: string): Promise<string | null> {
  const cached = zoneFarmCache.get(zoneId);
  if (cached !== undefined) return cached;
  const rows = await query<{ farm_id: string }>(
    `SELECT farm_id FROM zones WHERE id = $1 LIMIT 1`,
    [zoneId],
  );
  const farmId = rows[0]?.farm_id ?? null;
  zoneFarmCache.set(zoneId, farmId);
  return farmId;
}
