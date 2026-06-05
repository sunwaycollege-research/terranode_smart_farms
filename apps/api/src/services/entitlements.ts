// Entitlements service (unit 3.1) — read/seed/update `entitlement_records`.
//
// In the 2-role model the admin can ALWAYS edit a customer's device-catalog
// entitlements (the old create-time lock is removed). Each customer account has
// exactly one entitlement_records row (account_id PK). Values are normalized
// against the canonical device catalog so unknown keys are dropped and missing
// keys fall back to their catalog default.

import { eq } from 'drizzle-orm';
import type {
  DeviceCatalogItem,
  EntitlementRecord,
  Entitlements,
  EntitlementValue,
  UUID,
} from '@teranode/types';
import { DEVICE_CATALOG, defaultEntitlements } from '@teranode/types';
import { db, schema } from '../db/client';

type EntitlementRow = typeof schema.entitlementRecords.$inferSelect;

/** DB row → wire entity. */
export function toEntitlementRecord(r: EntitlementRow): EntitlementRecord {
  return {
    accountId: r.accountId,
    values: r.values,
    updatedBy: r.updatedBy ?? null,
    updatedAt: r.updatedAt.toISOString(),
  };
}

/**
 * Normalize a raw entitlements blob against the canonical catalog:
 *  - every catalog key is present (falling back to its default),
 *  - values are coerced to the catalog kind (count → number, toggle → boolean),
 *  - unknown keys are dropped.
 */
export function normalizeEntitlements(raw: Entitlements | null | undefined): Entitlements {
  const base = defaultEntitlements();
  if (!raw || typeof raw !== 'object') return base;
  const out: Entitlements = {};
  for (const item of DEVICE_CATALOG) {
    out[item.key] = coerceValue(item, raw[item.key], base[item.key]);
  }
  return out;
}

function coerceValue(
  item: DeviceCatalogItem,
  value: unknown,
  fallback: EntitlementValue,
): EntitlementValue {
  if (item.kind === 'count') {
    const n = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
    if (Number.isFinite(n) && n >= 0) return Math.floor(n);
    return fallback;
  }
  // toggle
  if (typeof value === 'boolean') return value;
  if (value === 'true') return true;
  if (value === 'false') return false;
  return fallback;
}

/** Fetch a customer's entitlement record, or null if none exists yet. */
export async function getEntitlements(accountId: UUID): Promise<EntitlementRecord | null> {
  const rows = await db
    .select()
    .from(schema.entitlementRecords)
    .where(eq(schema.entitlementRecords.accountId, accountId))
    .limit(1);
  return rows[0] ? toEntitlementRecord(rows[0]) : null;
}

/** Fetch a customer's entitlement values, falling back to catalog defaults. */
export async function getEntitlementValues(accountId: UUID): Promise<Entitlements> {
  const rec = await getEntitlements(accountId);
  return rec ? normalizeEntitlements(rec.values) : defaultEntitlements();
}

/**
 * Create the default entitlement record for a freshly-created customer account.
 * Idempotent: re-running updates the existing row.
 */
export async function seedEntitlements(
  accountId: UUID,
  updatedBy: UUID,
  values?: Entitlements,
): Promise<EntitlementRecord> {
  const normalized = normalizeEntitlements(values);
  const rows = await db
    .insert(schema.entitlementRecords)
    .values({ accountId, values: normalized, updatedBy })
    .onConflictDoUpdate({
      target: schema.entitlementRecords.accountId,
      set: { values: normalized, updatedBy, updatedAt: new Date() },
    })
    .returning();
  return toEntitlementRecord(rows[0]);
}

/**
 * Update (upsert) a customer's entitlements — ALWAYS allowed for an admin (no
 * lock). Returns both the new record and the previous values for audit logging.
 */
export async function updateEntitlements(
  accountId: UUID,
  values: Entitlements,
  updatedBy: UUID,
): Promise<{ record: EntitlementRecord; previous: Entitlements | null }> {
  const existing = await getEntitlements(accountId);
  const normalized = normalizeEntitlements(values);
  const rows = await db
    .insert(schema.entitlementRecords)
    .values({ accountId, values: normalized, updatedBy })
    .onConflictDoUpdate({
      target: schema.entitlementRecords.accountId,
      set: { values: normalized, updatedBy, updatedAt: new Date() },
    })
    .returning();
  return { record: toEntitlementRecord(rows[0]), previous: existing?.values ?? null };
}
