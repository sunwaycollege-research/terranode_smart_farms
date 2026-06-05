// Zone + weather telemetry ingestion.
//
// A zone telemetry payload may arrive in either shape (we accept both so the
// virtual gateway in unit 4.2 is free to emit whichever):
//
//   A) flat (spec §4 ingest description):
//      { ts?, zoneId?, moisture, ph, ec, n, p, k, soilTemp,
//        airTemp?, humidity?, rain?,
//        valve?, pump?, dosing?, mode?, waterLiters? }
//
//   B) readings-array (MqttTelemetryPayload from @teranode/types):
//      { ts, zoneId, readings: [{ channel, value, quality? }, ...] }
//
// For each numeric channel we resolve sensor_channels.id (zone first, then farm
// for weather-ish channels) and INSERT one telemetry row. If the zone is
// irrigating (valve true) we INSERT a usage_events row (kind='water_liters').
// We UPDATE actuators.state for the zone valve and the farm pump. Finally we
// publish normalized WsTelemetry + WsState messages to Redis.

import type Redis from 'ioredis';
import type { MqttTelemetryPayload, MqttWeatherPayload } from '@teranode/types';
import { query } from '../db';
import { publishLive } from './publish';
import {
  resolveZoneChannel,
  resolveFarmChannel,
  resolveZoneFarm,
  toDbChannelType,
} from './channels';
import {
  setZoneValveState,
  setFarmPumpState,
  setFarmDosingState,
} from './actuators';
import type { ParsedTopic } from './topic';

/** Field names in a flat payload that are NOT numeric channels. */
const NON_CHANNEL_FIELDS = new Set([
  'ts',
  'timestamp',
  'zoneid',
  'zone',
  'valve',
  'pump',
  'dosing',
  'mode',
  'irrigating',
  'waterliters',
  'water_liters',
  'liters',
  'readings',
  'gatewayid',
  'farmid',
  'accountid',
]);

interface NormalizedReading {
  dbType: string;
  value: number;
  quality: number;
}

/** Pull channel readings out of either payload shape. */
function extractReadings(payload: Record<string, unknown>): NormalizedReading[] {
  const out: NormalizedReading[] = [];

  // Shape B: readings array
  const readings = payload.readings;
  if (Array.isArray(readings)) {
    for (const r of readings) {
      if (!r || typeof r !== 'object') continue;
      const rec = r as { channel?: unknown; value?: unknown; quality?: unknown };
      if (typeof rec.channel !== 'string' || typeof rec.value !== 'number') continue;
      const dbType = toDbChannelType(rec.channel);
      if (!dbType) continue;
      if (!Number.isFinite(rec.value)) continue;
      out.push({
        dbType,
        value: rec.value,
        quality: typeof rec.quality === 'number' ? rec.quality : 1,
      });
    }
    return out;
  }

  // Shape A: flat numeric fields
  for (const [key, raw] of Object.entries(payload)) {
    if (NON_CHANNEL_FIELDS.has(key.toLowerCase())) continue;
    if (typeof raw !== 'number' || !Number.isFinite(raw)) continue;
    const dbType = toDbChannelType(key);
    if (!dbType) continue;
    out.push({ dbType, value: raw, quality: 1 });
  }
  return out;
}

/** Truthy actuator flag — accepts boolean, 0/1, "on"/"open"/"true". */
function asBool(v: unknown): boolean | undefined {
  if (typeof v === 'boolean') return v;
  if (typeof v === 'number') return v !== 0;
  if (typeof v === 'string') {
    const s = v.toLowerCase();
    if (['1', 'true', 'on', 'open'].includes(s)) return true;
    if (['0', 'false', 'off', 'close', 'closed'].includes(s)) return false;
  }
  return undefined;
}

export interface ZoneIngestStats {
  zoneId: string;
  rows: number;
  irrigating: boolean;
}

/**
 * Handle one zone telemetry message. Returns ingest stats (or null if it could
 * not be resolved to a zone / had nothing usable).
 */
export async function handleZoneTelemetry(
  redis: Redis,
  parsed: ParsedTopic,
  payload: Record<string, unknown>,
): Promise<ZoneIngestStats | null> {
  // zoneId from topic wins; else from payload.
  const zoneId =
    parsed.zoneId ??
    (typeof payload.zoneId === 'string' ? (payload.zoneId as string) : undefined);
  if (!zoneId) return null;

  const farmId = parsed.farmId ?? (await resolveZoneFarm(zoneId));
  if (!farmId) return null;

  const ts = parseTs(payload.ts);
  const readings = extractReadings(payload);

  let rows = 0;
  for (const r of readings) {
    // zone channel first; fall back to a farm-level channel for weather-ish types.
    let channelId = await resolveZoneChannel(zoneId, r.dbType);
    let rowZoneId: string | null = zoneId;
    if (!channelId) {
      channelId = await resolveFarmChannel(farmId, r.dbType);
      rowZoneId = null;
    }
    if (!channelId) continue; // no configured channel → skip silently

    await query(
      `INSERT INTO telemetry (time, channel_id, zone_id, farm_id, value, quality)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [ts, channelId, rowZoneId, farmId, r.value, r.quality],
    );
    rows += 1;

    await publishLive(redis, {
      type: 'telemetry',
      farmId,
      zoneId: rowZoneId,
      channelId,
      channel: r.dbType,
      value: r.value,
      ts: ts.toISOString(),
    });
  }

  // actuator state from payload flags ----------------------------------------
  const valve = asBool(payload.valve);
  const pump = asBool(payload.pump);
  const dosing = asBool(payload.dosing);
  const irrigating =
    valve === true ||
    asBool(payload.irrigating) === true ||
    (typeof payload.waterLiters === 'number' && (payload.waterLiters as number) > 0);

  if (valve !== undefined) await setZoneValveState(redis, zoneId, farmId, valve);
  if (pump !== undefined) await setFarmPumpState(redis, farmId, pump);
  if (dosing !== undefined) await setFarmDosingState(redis, farmId, dosing);

  // usage event while irrigating ----------------------------------------------
  if (irrigating) {
    const liters = resolveLiters(payload);
    if (liters > 0) {
      await query(
        `INSERT INTO usage_events (time, farm_id, zone_id, kind, value)
         VALUES ($1, $2, $3, 'water_liters', $4)`,
        [ts, farmId, zoneId, liters],
      );
    }
  }

  return { zoneId, rows, irrigating };
}

/** Liters for this tick — explicit field, else a per-tick estimate. */
function resolveLiters(payload: Record<string, unknown>): number {
  const explicit =
    pickNumber(payload.waterLiters) ??
    pickNumber(payload.water_liters) ??
    pickNumber(payload.liters);
  if (explicit !== undefined && explicit >= 0) return explicit;
  // Fallback: a steady ~per-tick flow estimate (SIM_TICK_MS @ a nominal flow).
  const tickMs = Number(process.env.SIM_TICK_MS ?? 2000);
  const litersPerMin = Number(process.env.SIM_FLOW_LPM ?? 12);
  return (litersPerMin * tickMs) / 60_000;
}

function pickNumber(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}

/** Parse a payload ts (ISO string or epoch ms) → Date; default now. */
function parseTs(v: unknown): Date {
  if (typeof v === 'string') {
    const d = new Date(v);
    if (!Number.isNaN(d.getTime())) return d;
  }
  if (typeof v === 'number' && Number.isFinite(v)) {
    const d = new Date(v);
    if (!Number.isNaN(d.getTime())) return d;
  }
  return new Date();
}

export interface WeatherIngestStats {
  farmId: string;
  rows: number;
}

/** Handle one per-farm weather message (farm-level channels only). */
export async function handleWeather(
  redis: Redis,
  parsed: ParsedTopic,
  payload: Record<string, unknown>,
): Promise<WeatherIngestStats | null> {
  const farmId = parsed.farmId;
  if (!farmId) return null;
  const ts = parseTs(payload.ts);
  const readings = extractReadings(payload);

  let rows = 0;
  for (const r of readings) {
    const channelId = await resolveFarmChannel(farmId, r.dbType);
    if (!channelId) continue;
    await query(
      `INSERT INTO telemetry (time, channel_id, zone_id, farm_id, value, quality)
       VALUES ($1, $2, NULL, $3, $4, $5)`,
      [ts, channelId, farmId, r.value, r.quality],
    );
    rows += 1;
    await publishLive(redis, {
      type: 'telemetry',
      farmId,
      zoneId: null,
      channelId,
      channel: r.dbType,
      value: r.value,
      ts: ts.toISOString(),
    });
  }
  return { farmId, rows };
}

/** Re-export the typed payloads for callers that want them. */
export type { MqttTelemetryPayload, MqttWeatherPayload };
