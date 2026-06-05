// REAL — crops library routes (unit 3.5, spec §5).
//
//   GET   /crops              → { crops: CropRef[] }          (any authed user)
//   GET   /crops/:id          → CropWithStages                (any authed user)
//   POST  /crops              → CropRef                        (admin)
//   PATCH /crops/:id          → CropRef                        (admin)
//   PATCH /crops/:id/stages   → { cropId, stages }            (admin)
//
// Reads are open to any authenticated user (crops are advisory library data);
// writes require admin. All DB access lives in ../services/crops; this file only
// validates input (zod) and shapes responses from @teranode/types.

import { Router, type NextFunction, type Request, type Response } from 'express';
import { z } from 'zod';
import type {
  CreateCropResponse,
  GetCropResponse,
  ListCropsResponse,
  UpdateCropResponse,
  UpdateCropStagesResponse,
} from '@teranode/types';
import { requireAuth, requireAdmin } from '../middleware/auth';
import { HttpError } from '../middleware/error';
import {
  createCrop,
  getCropWithStages,
  listCrops,
  replaceCropStages,
  updateCrop,
} from '../services/crops';

export const cropsRouter = Router();

// --- async-handler wrapper (thrown errors → error middleware) ----------------

function wrap(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<void>,
): (req: Request, res: Response, next: NextFunction) => void {
  return (req, res, next) => {
    fn(req, res, next).catch(next);
  };
}

// --- zod schemas -------------------------------------------------------------

const cropCategorySchema = z.enum([
  'fruiting',
  'leafy',
  'root',
  'bulb',
  'legume',
  'brassica',
]);

const growthStageSchema = z.enum([
  'germination',
  'vegetative',
  'flowering',
  'fruiting',
  'harvest',
]);

/** [low, high] inclusive band. */
const rangeSchema = z.tuple([z.number(), z.number()]);

/** A full set of agronomic bands (CropBand). */
const cropBandSchema = z.object({
  moisture: rangeSchema,
  ph: rangeSchema,
  ec: rangeSchema,
  n: rangeSchema,
  p: rangeSchema,
  k: rangeSchema,
  soilTemp: rangeSchema,
  airTemp: rangeSchema,
});

/** Editable crop fields shared by POST/PATCH (CropInput). */
const cropInputShape = {
  nameEn: z.string().min(1),
  nameNe: z.string().min(1),
  emoji: z.string().min(1),
  category: cropCategorySchema,
  daysToHarvest: z.number().int().positive(),
  wateringNotesEn: z.string().optional(),
  wateringNotesNe: z.string().optional(),
  ideal: cropBandSchema,
  acceptable: cropBandSchema,
};

/** POST /crops — full input + required slug id. */
const createCropSchema = z.object({
  id: z
    .string()
    .min(1)
    .regex(/^[a-z0-9][a-z0-9_-]*$/, 'id must be a lowercase slug'),
  ...cropInputShape,
});

/** PATCH /crops/:id — every field optional. */
const updateCropSchema = z
  .object({
    nameEn: cropInputShape.nameEn.optional(),
    nameNe: cropInputShape.nameNe.optional(),
    emoji: cropInputShape.emoji.optional(),
    category: cropInputShape.category.optional(),
    daysToHarvest: cropInputShape.daysToHarvest.optional(),
    wateringNotesEn: z.string().optional(),
    wateringNotesNe: z.string().optional(),
    ideal: cropBandSchema.optional(),
    acceptable: cropBandSchema.optional(),
  })
  .strict();

/** One stage in a PATCH /crops/:id/stages payload (CropStageInput). */
const cropStageInputSchema = z.object({
  stage: growthStageSchema,
  ordinal: z.number().int().nonnegative(),
  startDay: z.number().int().nonnegative(),
  ideal: cropBandSchema,
  acceptable: cropBandSchema,
});

/** PATCH /crops/:id/stages — replaces the crop's stage set. */
const updateStagesSchema = z.object({
  stages: z.array(cropStageInputSchema),
});

/** Parse a body against a schema; 400 (with zod issues) on failure. */
function parseBody<T>(schema: z.ZodType<T>, body: unknown): T {
  const result = schema.safeParse(body ?? {});
  if (!result.success) {
    throw new HttpError(400, 'invalid request body', { issues: result.error.issues });
  }
  return result.data;
}

// --- GET /crops (any authed) -------------------------------------------------

cropsRouter.get(
  '/',
  requireAuth,
  wrap(async (_req, res) => {
    const crops = await listCrops();
    const body: ListCropsResponse = { crops };
    res.json(body);
  }),
);

// --- GET /crops/:id (any authed) ---------------------------------------------

cropsRouter.get(
  '/:id',
  requireAuth,
  wrap(async (req, res) => {
    const body: GetCropResponse = await getCropWithStages(req.params.id);
    res.json(body);
  }),
);

// --- POST /crops (admin) -----------------------------------------------------

cropsRouter.post(
  '/',
  requireAdmin,
  wrap(async (req, res) => {
    const input = parseBody(createCropSchema, req.body);
    const body: CreateCropResponse = await createCrop(input);
    res.status(201).json(body);
  }),
);

// --- PATCH /crops/:id (admin) ------------------------------------------------

cropsRouter.patch(
  '/:id',
  requireAdmin,
  wrap(async (req, res) => {
    const patch = parseBody(updateCropSchema, req.body);
    const body: UpdateCropResponse = await updateCrop(req.params.id, patch);
    res.json(body);
  }),
);

// --- PATCH /crops/:id/stages (admin) -----------------------------------------

cropsRouter.patch(
  '/:id/stages',
  requireAdmin,
  wrap(async (req, res) => {
    const { stages } = parseBody(updateStagesSchema, req.body);
    const rows = await replaceCropStages(req.params.id, stages);
    const body: UpdateCropStagesResponse = { cropId: req.params.id, stages: rows };
    res.json(body);
  }),
);
