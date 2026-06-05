// Crops service (unit 3.5) — DB access + (de)serialization for the crop library.
//
// Owns all DB I/O for the crops catalog so the route file stays thin:
//   listCrops()                 → CropRef[]            (flat library rows)
//   getCropWithStages(id)       → CropWithStages       (crop + ordered stages)
//   createCrop(input)           → CropRef
//   updateCrop(id, patch)       → CropRef
//   replaceCropStages(id, set)  → CropStageRow[]       (full replace, ordered)
//
// Crop bands (`ideal`/`acceptable`) are jsonb columns typed as `CropBand`, so
// they pass through untouched; only timestamps need ISO serialization. The
// `category` / `stage` text columns are widened TS strings in the DB row, so we
// narrow them back to their enum types on the way out.

import { asc, eq } from 'drizzle-orm';
import type {
  CropCategory,
  CropInput,
  CropRef,
  CropStageInput,
  CropStageRow,
  CropWithStages,
  GrowthStage,
  UpdateCropRequest,
} from '@teranode/types';
import { db, schema } from '../db/client';
import { HttpError } from '../middleware/error';

type CropRow = typeof schema.crops.$inferSelect;
type CropStageDbRow = typeof schema.cropStages.$inferSelect;

// --- serializers (DB row → wire entity) --------------------------------------

function toCropRef(r: CropRow): CropRef {
  return {
    id: r.id,
    nameEn: r.nameEn,
    nameNe: r.nameNe,
    emoji: r.emoji,
    category: r.category as CropCategory,
    daysToHarvest: r.daysToHarvest,
    wateringNotesEn: r.wateringNotesEn ?? null,
    wateringNotesNe: r.wateringNotesNe ?? null,
    ideal: r.ideal,
    acceptable: r.acceptable,
    createdAt: r.createdAt.toISOString(),
  };
}

function toCropStageRow(r: CropStageDbRow): CropStageRow {
  return {
    id: r.id,
    cropId: r.cropId,
    stage: r.stage as GrowthStage,
    ordinal: r.ordinal,
    startDay: r.startDay,
    ideal: r.ideal,
    acceptable: r.acceptable,
  };
}

// --- queries -----------------------------------------------------------------

/** All crops in the library, ordered by id. */
export async function listCrops(): Promise<CropRef[]> {
  const rows = await db.select().from(schema.crops).orderBy(asc(schema.crops.id));
  return rows.map(toCropRef);
}

/** Load one crop row (or undefined). */
async function loadCrop(id: string): Promise<CropRow | undefined> {
  const rows = await db.select().from(schema.crops).where(eq(schema.crops.id, id)).limit(1);
  return rows[0];
}

/** Load a crop's stage rows, ordered by ordinal then startDay. */
async function loadStages(cropId: string): Promise<CropStageDbRow[]> {
  return db
    .select()
    .from(schema.cropStages)
    .where(eq(schema.cropStages.cropId, cropId))
    .orderBy(asc(schema.cropStages.ordinal), asc(schema.cropStages.startDay));
}

/** One crop joined with its (ordered) stage rows. 404 when missing. */
export async function getCropWithStages(id: string): Promise<CropWithStages> {
  const crop = await loadCrop(id);
  if (!crop) throw new HttpError(404, 'crop not found', { cropId: id });
  const stages = await loadStages(id);
  return { ...toCropRef(crop), stages: stages.map(toCropStageRow) };
}

// --- mutations (admin) -------------------------------------------------------

/** Create a new crop row. 409 when the id already exists. */
export async function createCrop(input: CropInput & { id: string }): Promise<CropRef> {
  const id = input.id.trim();
  const existing = await loadCrop(id);
  if (existing) throw new HttpError(409, 'crop already exists', { cropId: id });

  const inserted = await db
    .insert(schema.crops)
    .values({
      id,
      nameEn: input.nameEn,
      nameNe: input.nameNe,
      emoji: input.emoji,
      category: input.category,
      daysToHarvest: input.daysToHarvest,
      wateringNotesEn: input.wateringNotesEn ?? null,
      wateringNotesNe: input.wateringNotesNe ?? null,
      ideal: input.ideal,
      acceptable: input.acceptable,
    })
    .returning();

  return toCropRef(inserted[0]);
}

/** Patch an existing crop's editable fields. 404 when missing. */
export async function updateCrop(id: string, patch: UpdateCropRequest): Promise<CropRef> {
  const existing = await loadCrop(id);
  if (!existing) throw new HttpError(404, 'crop not found', { cropId: id });

  // Build only the provided columns (id is immutable here).
  const set: Partial<typeof schema.crops.$inferInsert> = {};
  if (patch.nameEn !== undefined) set.nameEn = patch.nameEn;
  if (patch.nameNe !== undefined) set.nameNe = patch.nameNe;
  if (patch.emoji !== undefined) set.emoji = patch.emoji;
  if (patch.category !== undefined) set.category = patch.category;
  if (patch.daysToHarvest !== undefined) set.daysToHarvest = patch.daysToHarvest;
  if (patch.wateringNotesEn !== undefined) set.wateringNotesEn = patch.wateringNotesEn ?? null;
  if (patch.wateringNotesNe !== undefined) set.wateringNotesNe = patch.wateringNotesNe ?? null;
  if (patch.ideal !== undefined) set.ideal = patch.ideal;
  if (patch.acceptable !== undefined) set.acceptable = patch.acceptable;

  if (Object.keys(set).length === 0) return toCropRef(existing);

  const updated = await db
    .update(schema.crops)
    .set(set)
    .where(eq(schema.crops.id, id))
    .returning();

  return toCropRef(updated[0]);
}

/**
 * Replace a crop's entire stage set (PATCH /crops/:id/stages). Deletes the
 * existing stages and inserts the supplied set, deriving each row id as
 * `<cropId>:<stage>`. 404 when the crop is missing. Returns the new ordered set.
 */
export async function replaceCropStages(
  cropId: string,
  stages: CropStageInput[],
): Promise<CropStageRow[]> {
  const crop = await loadCrop(cropId);
  if (!crop) throw new HttpError(404, 'crop not found', { cropId });

  // Reject duplicate stage labels up front (the (crop_id, stage) unique
  // constraint would 500 otherwise, and the derived id would collide).
  const seen = new Set<string>();
  for (const s of stages) {
    if (seen.has(s.stage)) {
      throw new HttpError(400, 'duplicate stage in payload', { stage: s.stage });
    }
    seen.add(s.stage);
  }

  await db.transaction(async (tx) => {
    await tx.delete(schema.cropStages).where(eq(schema.cropStages.cropId, cropId));
    if (stages.length > 0) {
      await tx.insert(schema.cropStages).values(
        stages.map((s) => ({
          id: `${cropId}:${s.stage}`,
          cropId,
          stage: s.stage,
          ordinal: s.ordinal,
          startDay: s.startDay,
          ideal: s.ideal,
          acceptable: s.acceptable,
        })),
      );
    }
  });

  const rows = await loadStages(cropId);
  return rows.map(toCropStageRow);
}
