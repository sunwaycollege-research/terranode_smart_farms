// REAL — zone routes (spec §5, unit 3.2). Mounted at /zones by index.ts.
//
//   POST   /zones                 → create a zone under a farm
//   PATCH  /zones/:id             → update name/area/node/mode
//   DELETE /zones/:id             → delete a zone (+ its rules/channels)
//   POST   /zones/:id/assign      → assign crop + planting date, create sensor
//                                   channels, derive + UPSERT the crop rule
//   GET    /zones/:id/analysis    → agronomy: stage/health/channels/recs/rule
//   GET    /zones/:id/telemetry   → time-series (agg = raw|5m|1h|1d)
//
// NB: /zones/:id/rules is owned by unit 3.3 (rules router) and intentionally not
// handled here. All handlers run behind requireAuth + scopeToCustomer.

import { Router, type NextFunction, type Request, type Response } from 'express';
import { z } from 'zod';
import type {
  ActuatorCommandResponse,
  AssignZoneResponse,
  CreateZoneResponse,
  DeleteZoneResponse,
  TelemetryAgg,
  TelemetryResponse,
  UpdateZoneResponse,
  ZoneAnalysisResponse,
  ZoneWithCrop,
} from '@teranode/types';
import { CHANNEL_TYPES, CONTROL_MODES } from '@teranode/types';
import { requireAuth, scopeToCustomer, type RequestScope } from '../middleware/auth';
import { HttpError } from '../middleware/error';
import {
  assignZone,
  createZone,
  deleteZone,
  getZoneAnalysis,
  getZoneTelemetry,
  updateZone,
} from '../services/zones';
import { getZoneWithCrop } from '../services/farms';
import { commandZoneValve } from '../services/control';

export const zonesRouter = Router();

zonesRouter.use(requireAuth, scopeToCustomer);

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

const controlMode = z.enum(CONTROL_MODES as unknown as [string, ...string[]]);
const channelType = z.enum(CHANNEL_TYPES as unknown as [string, ...string[]]);

const createZoneSchema = z.object({
  farmId: z.string().uuid('farmId must be a UUID'),
  name: z.string().min(1, 'name is required'),
  cropId: z.string().min(1).optional(),
  plantingDate: z.string().min(1).optional(),
  areaM2: z.number().nonnegative().optional(),
  nodeId: z.string().uuid().optional(),
  mode: controlMode.optional(),
});

const updateZoneSchema = z
  .object({
    name: z.string().min(1).optional(),
    areaM2: z.number().nonnegative().nullable().optional(),
    nodeId: z.string().uuid().nullable().optional(),
    mode: controlMode.optional(),
  })
  .strict();

const channelInputSchema = z.object({
  type: channelType,
  unit: z.string().optional(),
  enabled: z.boolean().optional(),
  calibration: z.record(z.string(), z.unknown()).optional(),
});

const assignZoneSchema = z.object({
  cropId: z.string().min(1, 'cropId is required'),
  plantingDate: z.string().min(1, 'plantingDate is required'),
  nodeId: z.string().uuid().optional(),
  channels: z.array(channelInputSchema).optional(),
});

const VALID_AGG: readonly TelemetryAgg[] = ['raw', '5m', '1h', '1d'];

const valveSchema = z.object({ open: z.boolean() });

// --- GET /zones/:id ----------------------------------------------------------

zonesRouter.get(
  '/:id',
  wrap(async (req, res) => {
    const zone = await getZoneWithCrop(scopeOf(req), req.params.id);
    const body: ZoneWithCrop = zone;
    res.json(body);
  }),
);

// --- POST /zones/:id/valve ---------------------------------------------------

zonesRouter.post(
  '/:id/valve',
  wrap(async (req, res) => {
    const parsed = valveSchema.safeParse(req.body ?? {});
    if (!parsed.success) throw new HttpError(400, 'open (boolean) is required');
    const result = await commandZoneValve(req.params.id, parsed.data.open, scopeOf(req));
    const body: ActuatorCommandResponse = result;
    res.json(body);
  }),
);

// --- POST /zones -------------------------------------------------------------

zonesRouter.post(
  '/',
  wrap(async (req, res) => {
    const parsed = createZoneSchema.safeParse(req.body ?? {});
    if (!parsed.success) throw new HttpError(400, 'invalid zone payload', parsed.error.flatten());
    const zone = await createZone(scopeOf(req), {
      farmId: parsed.data.farmId,
      name: parsed.data.name,
      cropId: parsed.data.cropId,
      plantingDate: parsed.data.plantingDate,
      areaM2: parsed.data.areaM2,
      nodeId: parsed.data.nodeId,
      mode: parsed.data.mode as CreateZoneResponse['mode'] | undefined,
    });
    const body: CreateZoneResponse = zone;
    res.status(201).json(body);
  }),
);

// --- PATCH /zones/:id --------------------------------------------------------

zonesRouter.patch(
  '/:id',
  wrap(async (req, res) => {
    const parsed = updateZoneSchema.safeParse(req.body ?? {});
    if (!parsed.success) throw new HttpError(400, 'invalid zone payload', parsed.error.flatten());
    const zone = await updateZone(scopeOf(req), req.params.id, {
      name: parsed.data.name,
      areaM2: parsed.data.areaM2 ?? undefined,
      nodeId: parsed.data.nodeId,
      mode: parsed.data.mode as UpdateZoneResponse['mode'] | undefined,
    });
    const body: UpdateZoneResponse = zone;
    res.json(body);
  }),
);

// --- DELETE /zones/:id -------------------------------------------------------

zonesRouter.delete(
  '/:id',
  wrap(async (req, res) => {
    await deleteZone(scopeOf(req), req.params.id);
    const body: DeleteZoneResponse = { ok: true };
    res.json(body);
  }),
);

// --- POST /zones/:id/assign --------------------------------------------------

zonesRouter.post(
  '/:id/assign',
  wrap(async (req, res) => {
    const parsed = assignZoneSchema.safeParse(req.body ?? {});
    if (!parsed.success) throw new HttpError(400, 'invalid assign payload', parsed.error.flatten());
    const result = await assignZone(scopeOf(req), req.params.id, {
      cropId: parsed.data.cropId,
      plantingDate: parsed.data.plantingDate,
      nodeId: parsed.data.nodeId,
      channels: parsed.data.channels?.map((c) => ({
        type: c.type as AssignZoneResponse['channels'][number]['type'],
        unit: c.unit ?? '',
        enabled: c.enabled,
        calibration: c.calibration,
      })),
    });
    const body: AssignZoneResponse = result;
    res.json(body);
  }),
);

// --- GET /zones/:id/analysis -------------------------------------------------

zonesRouter.get(
  '/:id/analysis',
  wrap(async (req, res) => {
    const result = await getZoneAnalysis(scopeOf(req), req.params.id);
    const body: ZoneAnalysisResponse = result;
    res.json(body);
  }),
);

// --- GET /zones/:id/telemetry?from&to&agg ------------------------------------

zonesRouter.get(
  '/:id/telemetry',
  wrap(async (req, res) => {
    const aggRaw = typeof req.query.agg === 'string' ? req.query.agg : 'raw';
    if (!VALID_AGG.includes(aggRaw as TelemetryAgg)) {
      throw new HttpError(400, `agg must be one of ${VALID_AGG.join('|')}`);
    }
    const agg = aggRaw as TelemetryAgg;
    const from = typeof req.query.from === 'string' ? req.query.from : undefined;
    const to = typeof req.query.to === 'string' ? req.query.to : undefined;

    const result = await getZoneTelemetry(scopeOf(req), req.params.id, agg, from, to);
    const body: TelemetryResponse = {
      zoneId: req.params.id,
      agg: result.agg,
      ...(result.samples ? { samples: result.samples } : {}),
      ...(result.buckets ? { buckets: result.buckets } : {}),
    };
    res.json(body);
  }),
);
