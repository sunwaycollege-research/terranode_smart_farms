// REAL — farm routes (spec §5, unit 3.2). Mounted at /farms by index.ts.
//
//   GET    /farms              → list farms in the caller's tenant scope
//   POST   /farms              → create a farm (admin may target a customer)
//   GET    /farms/:id          → one farm
//   PATCH  /farms/:id          → update name/timezone/geo
//   DELETE /farms/:id          → delete (refuses if zones remain)
//   GET    /farms/:id/zones    → zones of a farm, each with its crop ref
//
// All handlers run behind requireAuth + scopeToCustomer: customers are
// hard-scoped to their own account; admins may retarget via ?accountId /
// body.accountId (resolved into req.scope upstream).

import { Router, type NextFunction, type Request, type Response } from 'express';
import { z } from 'zod';
import type {
  CreateFarmResponse,
  DeleteFarmResponse,
  GetFarmResponse,
  ListFarmsResponse,
  ListZonesResponse,
  UpdateFarmResponse,
} from '@teranode/types';
import { requireAuth, scopeToCustomer, type RequestScope } from '../middleware/auth';
import { HttpError } from '../middleware/error';
import {
  createFarm,
  deleteFarm,
  getFarm,
  listFarmZones,
  listFarms,
  updateFarm,
} from '../services/farms';

export const farmsRouter = Router();

farmsRouter.use(requireAuth, scopeToCustomer);

/** async-handler wrapper so thrown errors reach the error middleware. */
function wrap(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<void>,
): (req: Request, res: Response, next: NextFunction) => void {
  return (req, res, next) => {
    fn(req, res, next).catch(next);
  };
}

function scopeOf(req: Request): RequestScope {
  if (!req.scope) throw new HttpError(401, 'not authenticated');
  return req.scope;
}

const geoSchema = z.record(z.string(), z.unknown());

const createFarmSchema = z.object({
  name: z.string().min(1, 'name is required'),
  timezone: z.string().min(1).optional(),
  geo: geoSchema.optional(),
  // accountId is consumed by scopeToCustomer; accept+ignore it here.
  accountId: z.string().uuid().optional(),
});

const updateFarmSchema = z
  .object({
    name: z.string().min(1).optional(),
    timezone: z.string().min(1).optional(),
    geo: geoSchema.optional(),
  })
  .strict();

// --- GET /farms --------------------------------------------------------------

farmsRouter.get(
  '/',
  wrap(async (req, res) => {
    const farms = await listFarms(scopeOf(req));
    const body: ListFarmsResponse = { farms };
    res.json(body);
  }),
);

// --- POST /farms -------------------------------------------------------------

farmsRouter.post(
  '/',
  wrap(async (req, res) => {
    const parsed = createFarmSchema.safeParse(req.body ?? {});
    if (!parsed.success) throw new HttpError(400, 'invalid farm payload', parsed.error.flatten());
    const farm = await createFarm(scopeOf(req), {
      name: parsed.data.name,
      timezone: parsed.data.timezone,
      geo: parsed.data.geo,
    });
    const body: CreateFarmResponse = farm;
    res.status(201).json(body);
  }),
);

// --- GET /farms/:id ----------------------------------------------------------

farmsRouter.get(
  '/:id',
  wrap(async (req, res) => {
    const farm = await getFarm(scopeOf(req), req.params.id);
    const body: GetFarmResponse = farm;
    res.json(body);
  }),
);

// --- PATCH /farms/:id --------------------------------------------------------

farmsRouter.patch(
  '/:id',
  wrap(async (req, res) => {
    const parsed = updateFarmSchema.safeParse(req.body ?? {});
    if (!parsed.success) throw new HttpError(400, 'invalid farm payload', parsed.error.flatten());
    const farm = await updateFarm(scopeOf(req), req.params.id, parsed.data);
    const body: UpdateFarmResponse = farm;
    res.json(body);
  }),
);

// --- DELETE /farms/:id -------------------------------------------------------

farmsRouter.delete(
  '/:id',
  wrap(async (req, res) => {
    await deleteFarm(scopeOf(req), req.params.id);
    const body: DeleteFarmResponse = { ok: true };
    res.json(body);
  }),
);

// --- GET /farms/:id/zones ----------------------------------------------------

farmsRouter.get(
  '/:id/zones',
  wrap(async (req, res) => {
    const zones = await listFarmZones(scopeOf(req), req.params.id);
    const body: ListZonesResponse = { zones };
    res.json(body);
  }),
);
