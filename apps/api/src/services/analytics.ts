// Analytics service (unit 3.6) — water/fertilizer usage rollups, savings vs a
// flood-irrigation baseline, and a hand-rolled CSV export. Customer-scoped: the
// caller always resolves the effective accountId via scopeToCustomer, and every
// query here re-verifies the farm belongs to that account so a customer can
// never read another tenant's usage.
//
// Source of truth for usage is the `usage_1d` TimescaleDB continuous aggregate
// (sum(value) per bucket, farm_id, zone_id, kind) defined in db/migrate.ts. We
// group the daily kind rows into two logical series — water (liters) and dose
// (millilitres of fertilizer) — so clients get one tidy daily bucket per metric.

import { pool } from '../db/client';
import type {
  SavingsResponse,
  TelemetryAgg,
  UsageBucket,
  UsageResponse,
  UUID,
} from '@teranode/types';

// --- usage-kind normalization -------------------------------------------------

/** The two logical usage series we report on. */
export type UsageMetric = 'water_liters' | 'dose_ml';

/**
 * Map a raw `usage_events.kind` string onto one of our logical metrics.
 * Ingest (Phase 4) emits `water_liters` while a valve is open and `dose_ml`
 * while a dosing pump runs; we also tolerate a few synonyms defensively so the
 * analytics surface keeps working if upstream naming drifts slightly.
 */
export function classifyKind(kind: string): UsageMetric | null {
  const k = kind.toLowerCase();
  if (k.includes('water') || k.includes('liter') || k.includes('litre') || k.includes('irrig')) {
    return 'water_liters';
  }
  if (k.includes('dose') || k.includes('fert') || k.endsWith('_ml') || k === 'ml') {
    return 'dose_ml';
  }
  return null;
}

// --- window defaults ----------------------------------------------------------

const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_WINDOW_DAYS = 30;

interface Window {
  from: Date;
  to: Date;
}

/**
 * Resolve a [from, to] window from optional ISO strings. Defaults to the last
 * 30 days ending now. Throws on an unparseable / inverted range.
 */
export function resolveWindow(from?: string, to?: string): Window {
  const toDate = to ? new Date(to) : new Date();
  if (Number.isNaN(toDate.getTime())) throw new Error('invalid "to" timestamp');
  const fromDate = from ? new Date(from) : new Date(toDate.getTime() - DEFAULT_WINDOW_DAYS * DAY_MS);
  if (Number.isNaN(fromDate.getTime())) throw new Error('invalid "from" timestamp');
  if (fromDate.getTime() > toDate.getTime()) throw new Error('"from" must be before "to"');
  return { from: fromDate, to: toDate };
}

/** Whole days spanned by a window (>= 1). */
export function windowDays(w: Window): number {
  return Math.max(1, Math.ceil((w.to.getTime() - w.from.getTime()) / DAY_MS));
}

// --- ownership ----------------------------------------------------------------

/**
 * Verify `farmId` exists and belongs to `accountId` (admins pass their own
 * effective accountId from scopeToCustomer, which may target any customer).
 * Returns the farm's total irrigated area (sum of zone area_m2) for baseline
 * math, or null when the farm is not visible to this account.
 */
export async function loadFarmForAccount(
  farmId: UUID,
  accountId: UUID,
): Promise<{ farmId: UUID; areaM2: number } | null> {
  const farmRes = await pool.query<{ id: string }>(
    `SELECT id FROM farms WHERE id = $1 AND account_id = $2 LIMIT 1`,
    [farmId, accountId],
  );
  if (farmRes.rowCount === 0) return null;

  const areaRes = await pool.query<{ area: string | null }>(
    `SELECT COALESCE(SUM(area_m2), 0) AS area FROM zones WHERE farm_id = $1`,
    [farmId],
  );
  const area = Number(areaRes.rows[0]?.area ?? 0);
  return { farmId, areaM2: Number.isFinite(area) ? area : 0 };
}

// --- usage rollups ------------------------------------------------------------

interface DailyKindRow {
  bucket: string; // timestamptz from the CAGG
  zone_id: string | null;
  kind: string;
  total: string; // numeric → string from pg
}

/**
 * Read daily usage buckets for a farm from the `usage_1d` continuous aggregate,
 * grouped into water + dose metrics. Each output bucket is one (day, zone-or-
 * farm, metric) total; the `kind` field carries the logical metric name so the
 * shape matches the UsageBucket DTO.
 */
export async function getUsage(
  farmId: UUID,
  window: Window,
  agg: TelemetryAgg,
): Promise<UsageResponse> {
  const res = await pool.query<DailyKindRow>(
    `SELECT bucket, zone_id, kind, total
       FROM usage_1d
      WHERE farm_id = $1
        AND bucket >= $2
        AND bucket <  $3
      ORDER BY bucket ASC, zone_id NULLS FIRST, kind ASC`,
    [farmId, window.from.toISOString(), window.to.toISOString()],
  );

  // Fold raw kinds into our two logical metrics, summing collisions per
  // (day, zone, metric) — e.g. several water-ish kinds collapse into one total.
  const folded = new Map<string, UsageBucket>();
  for (const row of res.rows) {
    const metric = classifyKind(row.kind);
    if (!metric) continue;
    const bucketDay = row.bucket.slice(0, 10); // ISODate (YYYY-MM-DD)
    const zoneId = row.zone_id ?? null;
    const key = `${bucketDay}|${zoneId ?? '-'}|${metric}`;
    const total = Number(row.total) || 0;
    const existing = folded.get(key);
    if (existing) {
      existing.total += total;
    } else {
      folded.set(key, { bucket: bucketDay, farmId, zoneId, kind: metric, total });
    }
  }

  const buckets = [...folded.values()].sort((a, b) => {
    if (a.bucket !== b.bucket) return a.bucket < b.bucket ? -1 : 1;
    if (a.kind !== b.kind) return a.kind < b.kind ? -1 : 1;
    return (a.zoneId ?? '').localeCompare(b.zoneId ?? '');
  });

  return { farmId, agg, buckets };
}

/** Total liters of water actually used across a window (all zones). */
export async function getWaterUsedLiters(farmId: UUID, window: Window): Promise<number> {
  const res = await pool.query<{ kind: string; total: string }>(
    `SELECT kind, SUM(total) AS total
       FROM usage_1d
      WHERE farm_id = $1
        AND bucket >= $2
        AND bucket <  $3
      GROUP BY kind`,
    [farmId, window.from.toISOString(), window.to.toISOString()],
  );
  let liters = 0;
  for (const row of res.rows) {
    if (classifyKind(row.kind) === 'water_liters') liters += Number(row.total) || 0;
  }
  return liters;
}

// --- savings ------------------------------------------------------------------

/**
 * Per-day flood-irrigation baseline depth in millimetres. Flood/furrow systems
 * apply far more water than drip/precision irrigation; ~8 mm/day across the
 * irrigated area is a conservative literature-typical figure (1 mm over 1 m² =
 * 1 liter), which is what TERANODE's controlled valves save against.
 */
const FLOOD_BASELINE_MM_PER_DAY = 8;

/** Fallback irrigated area (m²) when a farm has no zones with a set area. */
const FALLBACK_AREA_M2 = 1000;

/**
 * Estimate water savings vs a flood-irrigation baseline. Baseline liters =
 * area(m²) × 8 mm/day × days-in-window (1 mm·m² = 1 L). Actual liters come from
 * recorded `water_liters` usage. savedPct is clamped to [0, 100].
 */
export async function getSavings(
  farmId: UUID,
  areaM2: number,
  window: Window,
): Promise<SavingsResponse> {
  const waterUsedL = await getWaterUsedLiters(farmId, window);
  const days = windowDays(window);
  const area = areaM2 > 0 ? areaM2 : FALLBACK_AREA_M2;
  const baselineL = area * FLOOD_BASELINE_MM_PER_DAY * days;
  const savedL = Math.max(0, baselineL - waterUsedL);
  const savedPct = baselineL > 0 ? Math.min(100, Math.max(0, (savedL / baselineL) * 100)) : 0;
  return {
    farmId,
    waterUsedL: round(waterUsedL),
    baselineL: round(baselineL),
    savedL: round(savedL),
    savedPct: round(savedPct),
  };
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}

// --- CSV export ---------------------------------------------------------------

/** Quote a CSV field per RFC-4180 (wrap + double quotes only when needed). */
function csvField(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return '';
  const s = String(value);
  if (/[",\r\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

/** Join a row of fields into one CSV line. */
function csvRow(fields: Array<string | number | null | undefined>): string {
  return fields.map(csvField).join(',');
}

/**
 * Build a CSV document of daily usage buckets for a farm. One row per
 * (date, zone, metric, total). Pure string assembly — no CSV library (per the
 * "hand-roll CSV" rule). Uses CRLF line endings for spreadsheet friendliness.
 */
export function buildUsageCsv(usage: UsageResponse): string {
  const header = ['date', 'farm_id', 'zone_id', 'metric', 'total'];
  const lines = [csvRow(header)];
  for (const b of usage.buckets) {
    lines.push(csvRow([b.bucket, b.farmId, b.zoneId ?? '', b.kind, b.total]));
  }
  // RFC-4180 CRLF, with a trailing newline.
  return lines.join('\r\n') + '\r\n';
}

/** A filename suggestion for the export's Content-Disposition header. */
export function exportFilename(farmId: UUID, window: Window): string {
  const f = window.from.toISOString().slice(0, 10);
  const t = window.to.toISOString().slice(0, 10);
  return `teranode-usage-${farmId}-${f}_to_${t}.csv`;
}
