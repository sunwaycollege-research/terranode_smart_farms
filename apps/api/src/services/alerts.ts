// Service layer for unit 3.4 — alerts + harvest log (spec §5).
//
// Tenant boundary = the customer account. Alerts carry `account_id` directly,
// so listing/ack is scoped on that column. The harvest log has no account_id —
// it hangs off a zone (zone → farm → account), so harvest queries resolve the
// caller's zones first and constrain on that set.
//
// All DB access goes through the shared drizzle client (`../db/client`); rows
// are serialized into the wire entities from @teranode/types. Numeric/date
// columns come back from node-postgres as strings, so we normalize here.

import { and, desc, eq, gte, inArray, lte } from 'drizzle-orm';
import type {
  Alert,
  AlertSeverity,
  HarvestLog,
  ISODate,
  UUID,
} from '@teranode/types';
import { db, schema } from '../db/client';
import { HttpError } from '../middleware/error';

type AlertRow = typeof schema.alerts.$inferSelect;
type HarvestRow = typeof schema.harvestLog.$inferSelect;

// --- serializers (DB row → wire entity) --------------------------------------

/** Coerce a node-postgres `date` value (string|Date) into an ISO date `YYYY-MM-DD`. */
function toISODate(v: unknown): ISODate {
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return String(v);
}

/** Coerce a node-postgres `numeric` value (string|number|null) into number|null. */
function toNumberOrNull(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

function toAlert(a: AlertRow): Alert {
  return {
    id: a.id,
    accountId: a.accountId,
    farmId: a.farmId ?? null,
    zoneId: a.zoneId ?? null,
    severity: a.severity,
    type: a.type,
    messageEn: a.messageEn,
    messageNe: a.messageNe ?? null,
    ts: a.ts.toISOString(),
    acknowledgedAt: a.acknowledgedAt ? a.acknowledgedAt.toISOString() : null,
  };
}

function toHarvestLog(h: HarvestRow): HarvestLog {
  return {
    id: h.id,
    zoneId: h.zoneId,
    cropId: h.cropId,
    harvestedAt: toISODate(h.harvestedAt),
    yieldKg: toNumberOrNull(h.yieldKg),
    notes: h.notes ?? null,
  };
}

// --- alerts ------------------------------------------------------------------

export interface ListAlertsFilters {
  farmId?: UUID;
  zoneId?: UUID;
  severity?: AlertSeverity;
  acknowledged?: boolean;
  limit?: number;
}

const DEFAULT_ALERT_LIMIT = 100;
const MAX_ALERT_LIMIT = 500;

/** List alerts for an account, newest first, with optional filters. */
export async function listAlerts(
  accountId: UUID,
  filters: ListAlertsFilters = {},
): Promise<Alert[]> {
  const conds = [eq(schema.alerts.accountId, accountId)];
  if (filters.farmId) conds.push(eq(schema.alerts.farmId, filters.farmId));
  if (filters.zoneId) conds.push(eq(schema.alerts.zoneId, filters.zoneId));
  if (filters.severity) conds.push(eq(schema.alerts.severity, filters.severity));

  const limit = Math.min(
    Math.max(1, filters.limit ?? DEFAULT_ALERT_LIMIT),
    MAX_ALERT_LIMIT,
  );

  const rows = await db
    .select()
    .from(schema.alerts)
    .where(and(...conds))
    .orderBy(desc(schema.alerts.ts))
    .limit(limit);

  let result = rows;
  // `acknowledged` is a tri-state filter: undefined → all, true → acked only,
  // false → unacked only. Applied in JS to keep the column-null comparison simple.
  if (filters.acknowledged === true) {
    result = result.filter((r) => r.acknowledgedAt !== null);
  } else if (filters.acknowledged === false) {
    result = result.filter((r) => r.acknowledgedAt === null);
  }

  return result.map(toAlert);
}

/**
 * Mark an alert acknowledged (acknowledged_at = now). Idempotent — re-acking an
 * already-acked alert leaves the original timestamp untouched. Throws 404 if the
 * alert does not exist within the caller's account.
 */
export async function acknowledgeAlert(accountId: UUID, alertId: UUID): Promise<Alert> {
  const existing = await db
    .select()
    .from(schema.alerts)
    .where(and(eq(schema.alerts.id, alertId), eq(schema.alerts.accountId, accountId)))
    .limit(1);

  const current = existing[0];
  if (!current) throw new HttpError(404, 'alert not found');
  if (current.acknowledgedAt) return toAlert(current);

  const updated = await db
    .update(schema.alerts)
    .set({ acknowledgedAt: new Date() })
    .where(and(eq(schema.alerts.id, alertId), eq(schema.alerts.accountId, accountId)))
    .returning();

  return toAlert(updated[0] ?? current);
}

// --- harvest -----------------------------------------------------------------

export interface ListHarvestFilters {
  zoneId?: UUID;
  farmId?: UUID;
  from?: ISODate;
  to?: ISODate;
}

export interface CreateHarvestInput {
  zoneId: UUID;
  cropId?: string;
  harvestedAt: ISODate;
  yieldKg?: number;
  notes?: string;
}

/** Resolve the set of zone ids that belong to a given account (zone → farm → account). */
async function accountZoneIds(accountId: UUID): Promise<UUID[]> {
  const rows = await db
    .select({ id: schema.zones.id })
    .from(schema.zones)
    .innerJoin(schema.farms, eq(schema.zones.farmId, schema.farms.id))
    .where(eq(schema.farms.accountId, accountId));
  return rows.map((r) => r.id);
}

/** Resolve a single zone that belongs to the account (or null). */
async function loadOwnedZone(
  accountId: UUID,
  zoneId: UUID,
): Promise<{ id: UUID; cropId: string | null } | null> {
  const rows = await db
    .select({ id: schema.zones.id, cropId: schema.zones.cropId })
    .from(schema.zones)
    .innerJoin(schema.farms, eq(schema.zones.farmId, schema.farms.id))
    .where(and(eq(schema.zones.id, zoneId), eq(schema.farms.accountId, accountId)))
    .limit(1);
  const z = rows[0];
  return z ? { id: z.id, cropId: z.cropId ?? null } : null;
}

/** List harvest-log rows for an account's farms, newest first. */
export async function listHarvest(
  accountId: UUID,
  filters: ListHarvestFilters = {},
): Promise<HarvestLog[]> {
  // Constrain to a single zone if requested (and only if owned), else all
  // zones across the account's farms. A farmId filter narrows to that farm.
  let zoneIds: UUID[];
  if (filters.zoneId) {
    const owned = await loadOwnedZone(accountId, filters.zoneId);
    if (!owned) return [];
    zoneIds = [owned.id];
  } else if (filters.farmId) {
    const rows = await db
      .select({ id: schema.zones.id })
      .from(schema.zones)
      .innerJoin(schema.farms, eq(schema.zones.farmId, schema.farms.id))
      .where(and(eq(schema.zones.farmId, filters.farmId), eq(schema.farms.accountId, accountId)));
    zoneIds = rows.map((r) => r.id);
  } else {
    zoneIds = await accountZoneIds(accountId);
  }

  if (zoneIds.length === 0) return [];

  const conds = [inArray(schema.harvestLog.zoneId, zoneIds)];
  if (filters.from) conds.push(gte(schema.harvestLog.harvestedAt, filters.from));
  if (filters.to) conds.push(lte(schema.harvestLog.harvestedAt, filters.to));

  const rows = await db
    .select()
    .from(schema.harvestLog)
    .where(and(...conds))
    .orderBy(desc(schema.harvestLog.harvestedAt));

  return rows.map(toHarvestLog);
}

/**
 * Create a harvest-log row. The target zone must belong to the caller's account.
 * `cropId` defaults to the zone's currently-assigned crop when omitted; a 400 is
 * raised if neither is available.
 */
export async function createHarvest(
  accountId: UUID,
  input: CreateHarvestInput,
): Promise<HarvestLog> {
  const zone = await loadOwnedZone(accountId, input.zoneId);
  if (!zone) throw new HttpError(404, 'zone not found');

  const cropId = input.cropId ?? zone.cropId;
  if (!cropId) {
    throw new HttpError(400, 'cropId is required (zone has no assigned crop)');
  }

  const inserted = await db
    .insert(schema.harvestLog)
    .values({
      zoneId: zone.id,
      cropId,
      harvestedAt: input.harvestedAt,
      yieldKg: input.yieldKg !== undefined ? String(input.yieldKg) : null,
      notes: input.notes ?? null,
    })
    .returning();

  return toHarvestLog(inserted[0]);
}
