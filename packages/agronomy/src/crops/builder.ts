// Concise crop/stage builder used by every crop module.
//
// Each crop file declares its whole-crop ideal band plus a list of stage
// definitions (with day-since-planting and per-stage band overrides). The
// builder fills in ordinals, the wider `acceptable` bands, and the crop-level
// acceptable band so the data shape always matches the spec §3 `Crop` type.

import type {
  Crop,
  CropBand,
  CropCategory,
  CropStageDef,
  GrowthStage,
} from '@teranode/types';
import { stageIdeal, widenBand } from './bands';

/** A stage spec as authored in a crop file (acceptable is derived). */
export interface StageSpec {
  stage: GrowthStage;
  startDay: number;
  /** Per-stage band overrides; unspecified channels inherit the crop ideal. */
  ideal?: Partial<CropBand>;
}

/** Everything a crop file declares; the builder derives the rest. */
export interface CropSpec {
  id: string;
  nameEn: string;
  nameNe: string;
  emoji: string;
  category: CropCategory;
  daysToHarvest: number;
  wateringNotesEn: string;
  wateringNotesNe: string;
  ideal: CropBand;
  /** Optional override of the acceptable-widening fraction (default 0.25). */
  acceptableFrac?: number;
  stages: StageSpec[];
}

/**
 * Build a complete `Crop` from a `CropSpec`: derives ordinals (0-based in stage
 * order), each stage's ideal (crop ideal + overrides) and acceptable (widened),
 * and the crop-level acceptable band. Stages are sorted by startDay.
 */
export function buildCrop(spec: CropSpec): Crop {
  const frac = spec.acceptableFrac;
  const ordered = [...spec.stages].sort((a, b) => a.startDay - b.startDay);
  const stages: CropStageDef[] = ordered.map((s, i) => {
    const ideal = stageIdeal(spec.ideal, s.ideal ?? {});
    return {
      stage: s.stage,
      ordinal: i,
      startDay: s.startDay,
      ideal,
      acceptable: widenBand(ideal, frac),
    };
  });
  return {
    id: spec.id,
    nameEn: spec.nameEn,
    nameNe: spec.nameNe,
    emoji: spec.emoji,
    category: spec.category,
    daysToHarvest: spec.daysToHarvest,
    wateringNotesEn: spec.wateringNotesEn,
    wateringNotesNe: spec.wateringNotesNe,
    ideal: spec.ideal,
    acceptable: widenBand(spec.ideal, frac),
    stages,
  };
}
