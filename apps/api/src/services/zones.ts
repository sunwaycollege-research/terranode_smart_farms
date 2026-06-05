// Service layer for zone CRUD + crop assignment + agronomy analysis + telemetry
// (spec §5, unit 3.2). Tenant scoping is enforced by resolving each zone's
// owning farm and checking it against the caller's RequestScope (admins may
// cross-tenant; customers are hard-scoped to their own account).
//
// The crop-driven bits go through @teranode/agronomy:
//   - assignZone   → currentStage + deriveRule, then UPSERT rules(source='crop').
//   - analyzeZone  → reconstructs the rich Crop from the DB crop + crop_stages
//                    rows so an admin's edits to the library take effect, loads
//                    the latest reading per channel, and returns a ZoneAnalysis.

import { asc, desc, eq, inArray } from 'drizzle-orm';
import type {
  AssignZoneRequest,
  ChannelReadings,
  ChannelType,
  ControlMode,
  Crop,
  CropBand,
  CropStageDef,
  GrowthStage,
  Rule,
  RuleSource,
  SensorChannel,
  TelemetryAgg,
  TelemetryBucket,
  TelemetrySample,
  UUID,
  Zone,
  ZoneAnalysis,
  ZoneChannelInput,
} from '@teranode/types';
import { CHANNEL_DB_MAP, CHANNEL_ENGINE_MAP } from '@teranode/types';
import { analyzeZone, currentStage, deriveRule } from '@teranode/agronomy';
import { db, schema, pool } from '../db/client';
import { HttpError } from '../middleware/error';
import type { RequestScope } from '../middleware/auth';
import { loadOwnedFarm, toZone } from './farms';
import { getEntitlementValues } from './entitlements';

/**
 * Enforce the customer's `zoneNodes` entitlement as a hard cap on how many zones
 * they may create (one zone ≈ one zone node). Admins are not capped. The cap
 * counts every zone across the account's farms; the device-provisioning flow
 * inserts zones directly and is intentionally not gated here.
 */
async function assertZoneQuota(scope: RequestScope): Promise<void> {
  if (scope.isAdmin) return;
  const values = await getEntitlementValues(scope.accountId);
  const cap = typeof values.zoneNodes === 'number' ? values.zoneNodes : 0;
  const counted = await pool.query<{ n: string }>(
    `SELECT count(*)::int AS n FROM zones z JOIN farms f ON f.id = z.farm_id WHERE f.account_id = $1`,
    [scope.accountId],
  );
  const current = Number(counted.rows[0]?.n ?? 0);
  if (current >= cap) {
    throw new HttpError(
      403,
      `zone limit reached (${current}/${cap}); add zone nodes to your plan to create more`,
    );
  }
}

type ZoneRow = typeof schema.zones.$inferSelect;
type RuleRow = typeof schema.rules.$inferSelect;
type ChannelRow = typeof schema.sensorChannels.$inferSelect;
type CropRow = typeof schema.crops.$inferSelect;
type CropStageRow = typeof schema.cropStages.$inferSelect;

// --- serializers -------------------------------------------------------------

function num(v: string | number): number {
  return typeof v === 'number' ? v : Number(v);
}
function numOrNull(v: string | number | null): number | null {
  return v === null || v === undefined ? null : num(v);
}

export function toSensorChannel(r: ChannelRow): SensorChannel {
  return {
    id: r.id,
    zoneId: r.zoneId ?? null,
    farmId: r.farmId ?? null,
    type: r.type as ChannelType,
    unit: r.unit,
    calibration: (r.calibration as Record<string, unknown>) ?? {},
    enabled: r.enabled,
  };
}

export function toRule(r: RuleRow): Rule {
  return {
    zoneId: r.zoneId,
    moistureLow: num(r.moistureLow),
    moistureHigh: num(r.moistureHigh),
    rainSkipMm: num(r.rainSkipMm),
    phTarget: numOrNull(r.phTarget),
    ecTarget: numOrNull(r.ecTarget),
    source: r.source as RuleSource,
    appliedStage: r.appliedStage ?? null,
    updatedAt: r.updatedAt.toISOString(),
  };
}

// --- ownership ---------------------------------------------------------------

/** Load a zone and assert the caller's scope (via the owning farm) may see it. */
export async function loadOwnedZone(scope: RequestScope, zoneId: UUID): Promise<ZoneRow> {
  const rows = await db.select().from(schema.zones).where(eq(schema.zones.id, zoneId)).limit(1);
  const zone = rows[0];
  if (!zone) throw new HttpError(404, 'zone not found');
  // loadOwnedFarm throws 404 if the farm is not visible to this scope.
  await loadOwnedFarm(scope, zone.farmId);
  return zone;
}

// --- CRUD --------------------------------------------------------------------

export interface CreateZoneInput {
  farmId: UUID;
  name: string;
  cropId?: string;
  plantingDate?: string;
  areaM2?: number;
  nodeId?: UUID;
  mode?: ControlMode;
}

export async function createZone(scope: RequestScope, input: CreateZoneInput): Promise<Zone> {
  // The farm must exist and be visible to the caller's scope.
  await loadOwnedFarm(scope, input.farmId);
  // Enforce the zoneNodes entitlement as a hard cap (customers only).
  await assertZoneQuota(scope);
  if (input.cropId) await assertCropExists(input.cropId);

  const rows = await db
    .insert(schema.zones)
    .values({
      farmId: input.farmId,
      name: input.name,
      cropId: input.cropId ?? null,
      plantingDate: input.plantingDate ?? null,
      areaM2: input.areaM2 === undefined ? null : String(input.areaM2),
      nodeId: input.nodeId ?? null,
      mode: input.mode ?? 'auto',
    })
    .returning();
  return toZone(rows[0]);
}

export interface UpdateZoneInput {
  name?: string;
  areaM2?: number;
  nodeId?: UUID | null;
  mode?: ControlMode;
}

export async function updateZone(
  scope: RequestScope,
  zoneId: UUID,
  input: UpdateZoneInput,
): Promise<Zone> {
  await loadOwnedZone(scope, zoneId);
  const patch: Partial<typeof schema.zones.$inferInsert> = {};
  if (input.name !== undefined) patch.name = input.name;
  if (input.areaM2 !== undefined) patch.areaM2 = input.areaM2 === null ? null : String(input.areaM2);
  if (input.nodeId !== undefined) patch.nodeId = input.nodeId;
  if (input.mode !== undefined) patch.mode = input.mode;
  if (Object.keys(patch).length === 0) {
    const reread = await db.select().from(schema.zones).where(eq(schema.zones.id, zoneId)).limit(1);
    return toZone(reread[0]);
  }
  const rows = await db
    .update(schema.zones)
    .set(patch)
    .where(eq(schema.zones.id, zoneId))
    .returning();
  return toZone(rows[0]);
}

/** Delete a zone and its dependent rows (rules, sensor_channels) in a tx. */
export async function deleteZone(scope: RequestScope, zoneId: UUID): Promise<void> {
  await loadOwnedZone(scope, zoneId);
  await db.transaction(async (tx) => {
    await tx.delete(schema.rules).where(eq(schema.rules.zoneId, zoneId));
    await tx.delete(schema.sensorChannels).where(eq(schema.sensorChannels.zoneId, zoneId));
    await tx.delete(schema.zones).where(eq(schema.zones.id, zoneId));
  });
}

// --- crop assignment ---------------------------------------------------------

async function assertCropExists(cropId: string): Promise<CropRow> {
  const rows = await db.select().from(schema.crops).where(eq(schema.crops.id, cropId)).limit(1);
  if (!rows[0]) throw new HttpError(400, `unknown crop '${cropId}'`);
  return rows[0];
}

/** A sensible default unit per channel type when the caller omits one. */
function defaultUnit(type: ChannelType): string {
  switch (type) {
    case 'moisture':
    case 'humidity':
      return '%';
    case 'ph':
      return 'pH';
    case 'ec':
      return 'mS/cm';
    case 'n':
    case 'p':
    case 'k':
      return 'mg/kg';
    case 'soiltemp':
    case 'airtemp':
      return '°C';
    case 'pressure':
      return 'hPa';
    case 'rain':
      return 'mm';
    default:
      return '';
  }
}

export interface AssignResult {
  zone: Zone;
  channels: SensorChannel[];
  rule: Rule;
  analysis: ZoneAnalysis;
}

/**
 * Assign a crop to a zone: set crop_id + planting_date (+ node_id), create the
 * listed sensor channels, derive the controller rule from the crop's CURRENT
 * stage (via @teranode/agronomy) and UPSERT it with source='crop' +
 * applied_stage, then return the full analysis for an immediate UI update.
 */
export async function assignZone(
  scope: RequestScope,
  zoneId: UUID,
  input: AssignZoneRequest,
): Promise<AssignResult> {
  const zone = await loadOwnedZone(scope, zoneId);
  const cropRow = await assertCropExists(input.cropId);

  if (!input.plantingDate || Number.isNaN(Date.parse(input.plantingDate))) {
    throw new HttpError(400, 'plantingDate must be a valid ISO date');
  }

  const crop = await buildCrop(cropRow);
  const cs = currentStage(crop, input.plantingDate);
  const derived = deriveRule(crop, cs.def);

  const result = await db.transaction(async (tx) => {
    // 1) set the zone's crop / planting date / node.
    const zoneRows = await tx
      .update(schema.zones)
      .set({
        cropId: input.cropId,
        plantingDate: input.plantingDate,
        ...(input.nodeId !== undefined ? { nodeId: input.nodeId } : {}),
      })
      .where(eq(schema.zones.id, zoneId))
      .returning();

    // 2) create sensor channels for the requested types (skip ones already on
    //    the zone with the same type so re-assigning is idempotent).
    const requested: ZoneChannelInput[] = input.channels ?? [];
    let channelRows: ChannelRow[] = [];
    if (requested.length > 0) {
      const existing = await tx
        .select()
        .from(schema.sensorChannels)
        .where(eq(schema.sensorChannels.zoneId, zoneId));
      const existingTypes = new Set(existing.map((c) => c.type));
      const toInsert = requested
        .filter((c) => !existingTypes.has(c.type))
        .map((c) => ({
          zoneId,
          farmId: zone.farmId,
          type: c.type,
          unit: c.unit && c.unit.length > 0 ? c.unit : defaultUnit(c.type),
          calibration: c.calibration ?? {},
          enabled: c.enabled ?? true,
        }));
      const inserted = toInsert.length
        ? await tx.insert(schema.sensorChannels).values(toInsert).returning()
        : [];
      channelRows = [...existing, ...inserted];
    } else {
      channelRows = await tx
        .select()
        .from(schema.sensorChannels)
        .where(eq(schema.sensorChannels.zoneId, zoneId));
    }

    // 3) UPSERT the crop-derived rule.
    const ruleRows = await tx
      .insert(schema.rules)
      .values({
        zoneId,
        moistureLow: String(derived.moistureLow),
        moistureHigh: String(derived.moistureHigh),
        phTarget: String(derived.phTarget),
        ecTarget: String(derived.ecTarget),
        source: 'crop',
        appliedStage: cs.stage,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: schema.rules.zoneId,
        set: {
          moistureLow: String(derived.moistureLow),
          moistureHigh: String(derived.moistureHigh),
          phTarget: String(derived.phTarget),
          ecTarget: String(derived.ecTarget),
          source: 'crop',
          appliedStage: cs.stage,
          updatedAt: new Date(),
        },
      })
      .returning();

    return {
      zone: zoneRows[0],
      channels: channelRows,
      rule: ruleRows[0],
    };
  });

  // Build the analysis off the latest readings (none yet right after assign,
  // but keeps the contract uniform with GET /zones/:id/analysis).
  const readings = await latestReadings(zoneId);
  const analysis = analyzeZone({
    crop,
    plantingDate: input.plantingDate,
    readings,
  });

  return {
    zone: toZone(result.zone),
    channels: result.channels.map(toSensorChannel),
    rule: toRule(result.rule),
    analysis,
  };
}

// --- analysis ----------------------------------------------------------------

/**
 * Reconstruct the rich agronomy `Crop` (with its stage timeline) from the DB
 * `crops` + `crop_stages` rows so analysis reflects any admin edits to the
 * library. Falls back to a single whole-crop stage if no stage rows exist.
 */
async function buildCrop(cropRow: CropRow): Promise<Crop> {
  const stageRows = await db
    .select()
    .from(schema.cropStages)
    .where(eq(schema.cropStages.cropId, cropRow.id))
    .orderBy(asc(schema.cropStages.ordinal));

  const stages: CropStageDef[] = (stageRows.length ? stageRows : []).map((s: CropStageRow) => ({
    stage: s.stage as GrowthStage,
    ordinal: s.ordinal,
    startDay: s.startDay,
    ideal: s.ideal as CropBand,
    acceptable: s.acceptable as CropBand,
  }));

  if (stages.length === 0) {
    stages.push({
      stage: 'vegetative',
      ordinal: 0,
      startDay: 0,
      ideal: cropRow.ideal as CropBand,
      acceptable: cropRow.acceptable as CropBand,
    });
  }

  return {
    id: cropRow.id,
    nameEn: cropRow.nameEn,
    nameNe: cropRow.nameNe,
    emoji: cropRow.emoji,
    category: cropRow.category as Crop['category'],
    daysToHarvest: cropRow.daysToHarvest,
    wateringNotesEn: cropRow.wateringNotesEn ?? '',
    wateringNotesNe: cropRow.wateringNotesNe ?? '',
    ideal: cropRow.ideal as CropBand,
    acceptable: cropRow.acceptable as CropBand,
    stages,
  };
}

/** Latest value per (engine) channel for a zone, keyed by engine channel name. */
async function latestReadings(zoneId: UUID): Promise<ChannelReadings> {
  const channels = await db
    .select()
    .from(schema.sensorChannels)
    .where(eq(schema.sensorChannels.zoneId, zoneId));
  if (channels.length === 0) return {};

  const readings: ChannelReadings = {};
  // One DISTINCT-ON query: latest reading per channel for this zone.
  const channelIds = channels.map((c) => c.id);
  const latest = await db
    .selectDistinctOn([schema.telemetry.channelId], {
      channelId: schema.telemetry.channelId,
      value: schema.telemetry.value,
    })
    .from(schema.telemetry)
    .where(inArray(schema.telemetry.channelId, channelIds))
    .orderBy(schema.telemetry.channelId, desc(schema.telemetry.time));

  const valueByChannelId = new Map(latest.map((r) => [r.channelId, r.value]));
  for (const ch of channels) {
    const engineKey = CHANNEL_ENGINE_MAP[ch.type];
    if (!engineKey) continue; // humidity/pressure/rain have no engine band
    const v = valueByChannelId.get(ch.id);
    if (typeof v === 'number') readings[engineKey] = v;
  }
  return readings;
}

export interface ZoneAnalysisResult extends ZoneAnalysis {
  zoneId: UUID;
  cropId: string;
  readings: ChannelReadings;
}

export async function getZoneAnalysis(
  scope: RequestScope,
  zoneId: UUID,
): Promise<ZoneAnalysisResult> {
  const zone = await loadOwnedZone(scope, zoneId);
  if (!zone.cropId || !zone.plantingDate) {
    throw new HttpError(409, 'zone has no crop/planting date assigned; assign a crop first');
  }
  const cropRow = await assertCropExists(zone.cropId);
  const crop = await buildCrop(cropRow);
  const readings = await latestReadings(zoneId);

  const analysis = analyzeZone({
    crop,
    plantingDate: zone.plantingDate,
    readings,
  });

  return {
    ...analysis,
    zoneId,
    cropId: zone.cropId,
    readings,
  };
}

// --- telemetry ---------------------------------------------------------------

const CAGG_VIEW: Record<Exclude<TelemetryAgg, 'raw'>, string> = {
  '5m': 'telemetry_5m',
  '1h': 'telemetry_1h',
  '1d': 'telemetry_1d',
};

function parseWindow(from?: string, to?: string): { from: Date; to: Date } {
  const toDate = to && !Number.isNaN(Date.parse(to)) ? new Date(to) : new Date();
  const fromDate =
    from && !Number.isNaN(Date.parse(from))
      ? new Date(from)
      : new Date(toDate.getTime() - 24 * 60 * 60 * 1000); // default: last 24h
  return { from: fromDate, to: toDate };
}

export interface TelemetryResult {
  agg: TelemetryAgg;
  samples?: TelemetrySample[];
  buckets?: TelemetryBucket[];
}

/**
 * Time-series for a zone. agg=raw reads the `telemetry` hypertable; 5m|1h|1d
 * read the matching continuous aggregate view (telemetry_5m/1h/1d). Rows come
 * back ordered by channel then time so callers can group by channel_id.
 */
export async function getZoneTelemetry(
  scope: RequestScope,
  zoneId: UUID,
  agg: TelemetryAgg,
  from?: string,
  to?: string,
): Promise<TelemetryResult> {
  const zone = await loadOwnedZone(scope, zoneId);
  const window = parseWindow(from, to);

  if (agg === 'raw') {
    const raw = await pool.query(
      `SELECT time, channel_id, zone_id, farm_id, value, quality
         FROM telemetry
        WHERE zone_id = $1 AND time >= $2 AND time <= $3
        ORDER BY channel_id, time ASC`,
      [zoneId, window.from.toISOString(), window.to.toISOString()],
    );
    const samples: TelemetrySample[] = raw.rows.map((r: any) => ({
      time: new Date(r.time).toISOString(),
      channelId: r.channel_id,
      zoneId: r.zone_id ?? null,
      farmId: r.farm_id ?? null,
      value: Number(r.value),
      quality: Number(r.quality),
    }));
    return { agg, samples };
  }

  const view = CAGG_VIEW[agg];
  const res = await pool.query(
    `SELECT bucket, channel_id, zone_id, avg, min, max
       FROM ${view}
      WHERE zone_id = $1 AND bucket >= $2 AND bucket <= $3
      ORDER BY channel_id, bucket ASC`,
    [zoneId, window.from.toISOString(), window.to.toISOString()],
  );
  const buckets: TelemetryBucket[] = res.rows.map((r: any) => ({
    bucket: new Date(r.bucket).toISOString(),
    channelId: r.channel_id,
    zoneId: r.zone_id ?? null,
    avg: Number(r.avg),
    min: Number(r.min),
    max: Number(r.max),
  }));
  void zone;
  return { agg, buckets };
}

// re-export the engine channel maps used by callers / tests.
export { CHANNEL_DB_MAP, CHANNEL_ENGINE_MAP };
