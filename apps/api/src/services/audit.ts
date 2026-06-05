// Audit service (unit 3.1) — write + read the `audit_log`.
//
// Every admin mutation records a row via `writeAudit(...)` so there is a tamper-
// evident trail of who changed what (actor, action, target, before/after JSON).
// `listAudit(...)` powers GET /admin/audit with optional filtering.

import { and, desc, eq, gte, lte } from 'drizzle-orm';
import type { AuditEntry, ISODateTime, UUID } from '@teranode/types';
import { db, schema } from '../db/client';

type AuditRow = typeof schema.auditLog.$inferSelect;

/** DB row → wire entity. */
export function toAuditEntry(r: AuditRow): AuditEntry {
  return {
    id: r.id,
    actorId: r.actorId,
    accountId: r.accountId ?? null,
    action: r.action,
    target: r.target ?? null,
    before: r.before ?? null,
    after: r.after ?? null,
    ts: r.ts.toISOString(),
  };
}

/** Arguments for recording an audit entry. */
export interface WriteAuditArgs {
  /** The acting user (admin) id. */
  actorId: UUID;
  /** The account the action affected (customer account, gateway's account, …). */
  accountId?: UUID | null;
  /** A short verb-noun action key, e.g. `customer.create`. */
  action: string;
  /** A human/route reference to the affected object, e.g. `customer:<uuid>`. */
  target?: string | null;
  /** State before the change (null for creates). */
  before?: Record<string, unknown> | null;
  /** State after the change (null for deletes). */
  after?: Record<string, unknown> | null;
}

/**
 * Insert a single audit-log row. Never throws into the request path — auditing
 * must not fail a mutation that already succeeded; failures are logged instead.
 */
export async function writeAudit(args: WriteAuditArgs): Promise<void> {
  try {
    await db.insert(schema.auditLog).values({
      actorId: args.actorId,
      accountId: args.accountId ?? null,
      action: args.action,
      target: args.target ?? null,
      before: args.before ?? null,
      after: args.after ?? null,
    });
  } catch (err) {
    console.error('[audit] failed to write audit row', args.action, err);
  }
}

/** Filters for listing audit entries. */
export interface ListAuditArgs {
  accountId?: UUID;
  actorId?: UUID;
  from?: ISODateTime;
  to?: ISODateTime;
  limit?: number;
}

/** Read the most-recent audit entries (newest first), with optional filtering. */
export async function listAudit(args: ListAuditArgs = {}): Promise<AuditEntry[]> {
  const limit = clampLimit(args.limit, 100, 500);
  const conds = [];
  if (args.accountId) conds.push(eq(schema.auditLog.accountId, args.accountId));
  if (args.actorId) conds.push(eq(schema.auditLog.actorId, args.actorId));
  if (args.from) {
    const d = new Date(args.from);
    if (!Number.isNaN(d.getTime())) conds.push(gte(schema.auditLog.ts, d));
  }
  if (args.to) {
    const d = new Date(args.to);
    if (!Number.isNaN(d.getTime())) conds.push(lte(schema.auditLog.ts, d));
  }

  const rows = await db
    .select()
    .from(schema.auditLog)
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(desc(schema.auditLog.ts))
    .limit(limit);

  return rows.map(toAuditEntry);
}

/** Coerce + clamp a limit query param to a sane positive integer. */
export function clampLimit(raw: unknown, fallback: number, max: number): number {
  const n = typeof raw === 'string' ? Number(raw) : typeof raw === 'number' ? raw : NaN;
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(Math.floor(n), max);
}
