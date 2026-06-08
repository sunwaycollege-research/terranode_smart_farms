// Service layer for farm CRUD (spec §5, unit 3.2). All operations are tenant-
// scoped: a customer may only read/write farms under its own account; an admin
// may target any customer's account (resolved upstream by scopeToCustomer and
// passed in here as `scope`).
//
// Numeric/jsonb/timestamp columns are coerced to the wire shapes declared in
// @teranode/types here (drizzle returns `numeric` as string, timestamps as Date).

import { and, asc, eq } from 'drizzle-orm';
import type {
  ChannelType,
  CropRef,
  Farm,
  FarmReading,
  Gateway,
  GeoJson,
  UUID,
  Zone,
  ZoneWithCrop,
} from '@teranode/types';
import { db, pool, schema } from '../db/client';
import { HttpError } from '../middleware/error';
import type { RequestScope } from '../middleware/auth';
import { toGateway } from './customers';

type FarmRow = typeof schema.farms.$inferSelect;
type ZoneRow = typeof schema.zones.$inferSelect;
type CropRow = typeof schema.crops.$inferSelect;

// --- serializers -------------------------------------------------------------

export function toFarm(r: FarmRow): Farm {
  return {
    id: r.id,
    accountId: r.accountId,
    name: r.name,
    timezone: r.timezone,
    geo: (r.geo as GeoJson | null) ?? null,
    createdAt: r.createdAt.toISOString(),
  };
}

function numOrNull(v: string | null): number | null {
  return v === null || v === undefined ? null : Number(v);
}

export function toZone(r: ZoneRow): Zone {
  return {
    id: r.id,
    farmId: r.farmId,
    name: r.name,
    cropId: r.cropId ?? null,
    plantingDate: r.plantingDate ?? null,
    areaM2: numOrNull(r.areaM2),
    nodeId: r.nodeId ?? null,
    mode: r.mode as Zone['mode'],
    createdAt: r.createdAt.toISOString(),
  };
}

export function toCropRef(r: CropRow): CropRef {
  return {
    id: r.id,
    nameEn: r.nameEn,
    nameNe: r.nameNe,
    emoji: r.emoji,
    category: r.category as CropRef['category'],
    daysToHarvest: r.daysToHarvest,
    wateringNotesEn: r.wateringNotesEn ?? null,
    wateringNotesNe: r.wateringNotesNe ?? null,
    ideal: r.ideal,
    acceptable: r.acceptable,
    createdAt: r.createdAt.toISOString(),
  };
}

// --- helpers -----------------------------------------------------------------

/**
 * Load a farm by id and assert the caller's scope may see it. Customers are
 * hard-scoped to their own account; admins (scope.isAdmin) may read any farm.
 */
export async function loadOwnedFarm(scope: RequestScope, farmId: UUID): Promise<FarmRow> {
  const rows = await db.select().from(schema.farms).where(eq(schema.farms.id, farmId)).limit(1);
  const farm = rows[0];
  if (!farm) throw new HttpError(404, 'farm not found');
  if (!scope.isAdmin && farm.accountId !== scope.accountId) {
    throw new HttpError(404, 'farm not found');
  }
  return farm;
}

// --- queries -----------------------------------------------------------------

export async function listFarms(scope: RequestScope): Promise<Farm[]> {
  // Admins with no explicit ?accountId default to their own (admin) account,
  // which owns no farms — they retarget per-request via scopeToCustomer.
  const rows = await db
    .select()
    .from(schema.farms)
    .where(eq(schema.farms.accountId, scope.accountId))
    .orderBy(asc(schema.farms.createdAt));
  return rows.map(toFarm);
}

export interface CreateFarmInput {
  name: string;
  timezone?: string;
  geo?: GeoJson;
}

export async function createFarm(scope: RequestScope, input: CreateFarmInput): Promise<Farm> {
  const rows = await db
    .insert(schema.farms)
    .values({
      accountId: scope.accountId,
      name: input.name,
      timezone: input.timezone ?? 'Asia/Kathmandu',
      geo: input.geo ?? null,
    })
    .returning();
  return toFarm(rows[0]);
}

export async function getFarm(scope: RequestScope, farmId: UUID): Promise<Farm> {
  return toFarm(await loadOwnedFarm(scope, farmId));
}

export interface UpdateFarmInput {
  name?: string;
  timezone?: string;
  geo?: GeoJson;
}

export async function updateFarm(
  scope: RequestScope,
  farmId: UUID,
  input: UpdateFarmInput,
): Promise<Farm> {
  await loadOwnedFarm(scope, farmId);
  const patch: Partial<typeof schema.farms.$inferInsert> = {};
  if (input.name !== undefined) patch.name = input.name;
  if (input.timezone !== undefined) patch.timezone = input.timezone;
  if (input.geo !== undefined) patch.geo = input.geo;
  if (Object.keys(patch).length === 0) {
    return toFarm(await loadOwnedFarm(scope, farmId));
  }
  const rows = await db
    .update(schema.farms)
    .set(patch)
    .where(eq(schema.farms.id, farmId))
    .returning();
  return toFarm(rows[0]);
}

/**
 * Delete a farm. Refuses if the farm still has zones (the customer must remove
 * those first) to avoid orphaning telemetry / rules / channels.
 */
export async function deleteFarm(scope: RequestScope, farmId: UUID): Promise<void> {
  await loadOwnedFarm(scope, farmId);
  const childZones = await db
    .select({ id: schema.zones.id })
    .from(schema.zones)
    .where(eq(schema.zones.farmId, farmId))
    .limit(1);
  if (childZones.length > 0) {
    throw new HttpError(409, 'farm has zones; delete them first');
  }
  await db.delete(schema.farms).where(eq(schema.farms.id, farmId));
}

/** Zones belonging to a farm, each enriched with its crop reference (if any). */
export async function listFarmZones(scope: RequestScope, farmId: UUID): Promise<ZoneWithCrop[]> {
  await loadOwnedFarm(scope, farmId);
  const rows = await db
    .select({ zone: schema.zones, crop: schema.crops })
    .from(schema.zones)
    .leftJoin(schema.crops, eq(schema.zones.cropId, schema.crops.id))
    .where(eq(schema.zones.farmId, farmId))
    .orderBy(asc(schema.zones.createdAt));
  return rows.map((r) => ({
    ...toZone(r.zone),
    crop: r.crop ? toCropRef(r.crop) : null,
  }));
}

/** GET /zones/:id — a single zone (scoped via its farm) enriched with its crop ref. */
export async function getZoneWithCrop(scope: RequestScope, zoneId: UUID): Promise<ZoneWithCrop> {
  const rows = await db
    .select({ zone: schema.zones, crop: schema.crops, accountId: schema.farms.accountId })
    .from(schema.zones)
    .innerJoin(schema.farms, eq(schema.zones.farmId, schema.farms.id))
    .leftJoin(schema.crops, eq(schema.zones.cropId, schema.crops.id))
    .where(eq(schema.zones.id, zoneId))
    .limit(1);
  const row = rows[0];
  if (!row) throw new HttpError(404, 'zone not found');
  if (!scope.isAdmin && row.accountId !== scope.accountId) {
    throw new HttpError(403, 'cannot access another account');
  }
  return { ...toZone(row.zone), crop: row.crop ? toCropRef(row.crop) : null };
}

/** GET /farms/:id/gateway — the ESP32 brain bound to a farm (or null), customer-scoped. */
export async function getFarmGateway(scope: RequestScope, farmId: UUID): Promise<Gateway | null> {
  await loadOwnedFarm(scope, farmId);
  const rows = await db
    .select()
    .from(schema.gateways)
    .where(eq(schema.gateways.farmId, farmId))
    .orderBy(asc(schema.gateways.createdAt))
    .limit(1);
  return rows[0] ? toGateway(rows[0]) : null;
}

/**
 * GET /farms/:id/readings — the NEWEST reading per sensor channel across the
 * whole farm (zone soil channels + farm-level weather/flow). Powers the farmer
 * app's live sensor cards (moisture, NPK, flow/leak, rain, weather) in one call.
 */
export async function getFarmReadings(scope: RequestScope, farmId: UUID): Promise<FarmReading[]> {
  await loadOwnedFarm(scope, farmId);
  const res = await pool.query(
    `SELECT DISTINCT ON (t.channel_id)
        t.channel_id AS channel_id, c.type::text AS type, c.zone_id AS zone_id,
        c.unit AS unit, t.value AS value, t.time AS ts
       FROM telemetry t
       JOIN sensor_channels c ON c.id = t.channel_id
      WHERE t.farm_id = $1
      ORDER BY t.channel_id, t.time DESC`,
    [farmId],
  );
  return res.rows.map((r) => ({
    channelId: r.channel_id as string,
    type: r.type as ChannelType,
    zoneId: (r.zone_id as string | null) ?? null,
    unit: (r.unit as string | null) ?? null,
    value: Number(r.value),
    ts: r.ts instanceof Date ? r.ts.toISOString() : new Date(r.ts as string).toISOString(),
  }));
}

/** Re-export for unit cohesion (zones service shares the tenant check via farm). */
export { and, eq };
