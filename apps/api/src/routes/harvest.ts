// Harvest-log routes (spec §5) — customer-scoped list + create.
//
//   GET  /harvest    → { logs: HarvestLog[] }   for the caller's farms, newest first
//   POST /harvest    → HarvestLog               body {zoneId, cropId?, harvestedAt, yieldKg?, notes?}
//
// Harvest rows hang off a zone (zone → farm → account); the service constrains
// every read/write to zones owned by `req.scope.accountId`. `cropId` defaults to
// the zone's currently-assigned crop when the body omits it.

import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import type { CreateHarvestResponse, HarvestResponse } from '@teranode/types';
import { requireAuth, scopeToCustomer } from '../middleware/auth';
import { HttpError } from '../middleware/error';
import {
  createHarvest,
  listHarvest,
  type CreateHarvestInput,
  type ListHarvestFilters,
} from '../services/alerts';

export const harvestRouter = Router();

harvestRouter.use(requireAuth, scopeToCustomer);

/** Small async-handler wrapper so thrown errors reach the error middleware. */
function wrap(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<void>,
): (req: Request, res: Response, next: NextFunction) => void {
  return (req, res, next) => {
    fn(req, res, next).catch(next);
  };
}

const uuid = z.string().uuid();
// Accept full ISO datetimes too, but normalize to a calendar date (YYYY-MM-DD).
const isoDate = z
  .string()
  .min(1)
  .refine((v) => !Number.isNaN(Date.parse(v)), 'invalid date')
  .transform((v) => v.slice(0, 10));

const harvestQuerySchema = z.object({
  zoneId: uuid.optional(),
  farmId: uuid.optional(),
  from: isoDate.optional(),
  to: isoDate.optional(),
});

const createHarvestSchema = z.object({
  zoneId: uuid,
  cropId: z.string().min(1).optional(),
  harvestedAt: isoDate,
  yieldKg: z.coerce.number().nonnegative().optional(),
  notes: z.string().max(2000).optional(),
});

// --- GET /harvest ------------------------------------------------------------

harvestRouter.get(
  '/',
  wrap(async (req, res) => {
    const parsed = harvestQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      throw new HttpError(400, 'invalid query parameters', parsed.error.flatten());
    }
    const filters: ListHarvestFilters = parsed.data;
    const logs = await listHarvest(req.scope!.accountId, filters);
    const body: HarvestResponse = { logs };
    res.json(body);
  }),
);

// --- POST /harvest -----------------------------------------------------------

harvestRouter.post(
  '/',
  wrap(async (req, res) => {
    const parsed = createHarvestSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      throw new HttpError(400, 'invalid harvest payload', parsed.error.flatten());
    }
    const input: CreateHarvestInput = parsed.data;
    const log = await createHarvest(req.scope!.accountId, input);
    const body: CreateHarvestResponse = log;
    res.status(201).json(body);
  }),
);
