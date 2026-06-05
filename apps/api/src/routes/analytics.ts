// REAL — analytics routes (unit 3.6). Customer-scoped via scopeToCustomer; the
// effective accountId (a customer's own, or whatever a targeting admin chose)
// gates every farm read.
//
//   GET /analytics/usage?farmId&from&to&agg   → daily water + dose usage buckets
//   GET /analytics/savings?farmId&from&to     → liters saved vs flood baseline
//   GET /analytics/export?farmId&from&to&format=csv → text/csv attachment
//
// Usage is read from the `usage_1d` continuous aggregate; savings compares the
// recorded water usage to an area-based flood-irrigation baseline. See
// services/analytics.ts for the SQL + math.

import { Router, type Request, type Response, type NextFunction } from 'express';
import type {
  SavingsResponse,
  TelemetryAgg,
  UsageResponse,
  UUID,
} from '@teranode/types';
import { requireAuth, scopeToCustomer } from '../middleware/auth';
import { requireEntitlement } from '../middleware/entitlements';
import { HttpError } from '../middleware/error';
import {
  buildUsageCsv,
  exportFilename,
  getSavings,
  getUsage,
  loadFarmForAccount,
  resolveWindow,
} from '../services/analytics';

export const analyticsRouter = Router();

// Analytics is an entitlement-gated module: denied (403) unless the customer's
// `analytics` entitlement is on (admins bypass).
analyticsRouter.use(requireAuth, scopeToCustomer, requireEntitlement('analytics'));

/** Small async-handler wrapper so thrown errors reach the error middleware. */
function wrap(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<void>,
): (req: Request, res: Response, next: NextFunction) => void {
  return (req, res, next) => {
    fn(req, res, next).catch(next);
  };
}

/** Read & validate a single string query param. */
function strParam(req: Request, name: string): string | undefined {
  const v = req.query[name];
  return typeof v === 'string' && v.length > 0 ? v : undefined;
}

/** Validate the optional `agg` query param, defaulting to '1d'. */
function aggParam(req: Request): TelemetryAgg {
  const v = strParam(req, 'agg');
  if (v === undefined) return '1d';
  if (v === 'raw' || v === '5m' || v === '1h' || v === '1d') return v;
  throw new HttpError(400, 'agg must be one of raw|5m|1h|1d');
}

/**
 * Require a valid `farmId` query param that the scoped account can see, returning
 * the farm (with irrigated area). 400 when missing, 404 when not visible.
 */
async function requireFarm(req: Request): Promise<{ farmId: UUID; areaM2: number }> {
  const farmId = strParam(req, 'farmId');
  if (!farmId) throw new HttpError(400, 'farmId is required');
  const accountId = req.scope!.accountId;
  const farm = await loadFarmForAccount(farmId as UUID, accountId);
  if (!farm) throw new HttpError(404, 'farm not found');
  return farm;
}

/** Resolve [from, to], translating parse errors into 400s. */
function windowFromReq(req: Request) {
  try {
    return resolveWindow(strParam(req, 'from'), strParam(req, 'to'));
  } catch (e) {
    throw new HttpError(400, e instanceof Error ? e.message : 'invalid time window');
  }
}

// --- GET /analytics/usage ----------------------------------------------------

analyticsRouter.get(
  '/usage',
  wrap(async (req, res) => {
    const farm = await requireFarm(req);
    const window = windowFromReq(req);
    const agg = aggParam(req);
    const body: UsageResponse = await getUsage(farm.farmId, window, agg);
    res.json(body);
  }),
);

// --- GET /analytics/savings --------------------------------------------------

analyticsRouter.get(
  '/savings',
  wrap(async (req, res) => {
    const farm = await requireFarm(req);
    const window = windowFromReq(req);
    const body: SavingsResponse = await getSavings(farm.farmId, farm.areaM2, window);
    res.json(body);
  }),
);

// --- GET /analytics/export?format=csv ----------------------------------------

analyticsRouter.get(
  '/export',
  wrap(async (req, res) => {
    const format = strParam(req, 'format') ?? 'csv';
    if (format !== 'csv') throw new HttpError(400, 'only format=csv is supported');

    const farm = await requireFarm(req);
    const window = windowFromReq(req);
    const agg = aggParam(req);
    const usage = await getUsage(farm.farmId, window, agg);
    const csv = buildUsageCsv(usage);
    const filename = exportFilename(farm.farmId, window);

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(csv);
  }),
);
