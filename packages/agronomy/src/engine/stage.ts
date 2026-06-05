// Stage derivation: given a crop, a planting date, and "now", figure out which
// growth stage the zone is in by day-since-planting against each stage's startDay.

import type { Crop, CropStageDef, CurrentStageResult } from '@teranode/types';

/** Whole days between two instants (floor; never negative). */
function daysBetween(from: Date, to: Date): number {
  const ms = to.getTime() - from.getTime();
  return Math.max(0, Math.floor(ms / 86_400_000));
}

/** Coerce a Date | ISO string | epoch-ms into a Date. */
function toDate(d: Date | string | number): Date {
  return d instanceof Date ? d : new Date(d);
}

/**
 * The current growth stage for a planting. The active stage is the
 * highest-ordinal stage whose `startDay <= daysSincePlanting`; before the first
 * stage's startDay we clamp to the first stage. `daysToHarvest` is the crop's
 * total cycle length minus days elapsed (floored at 0).
 *
 * Stages are assumed sorted by startDay (the crop builder guarantees this) but
 * we sort defensively so callers can pass hand-built crops too.
 */
export function currentStage(
  crop: Crop,
  plantingDate: Date | string | number,
  now: Date | string | number = new Date(),
): CurrentStageResult {
  const planted = toDate(plantingDate);
  const nowDate = toDate(now);
  const daysSincePlanting = daysBetween(planted, nowDate);

  const sorted: CropStageDef[] = [...crop.stages].sort(
    (a, b) => a.startDay - b.startDay,
  );

  let def: CropStageDef = sorted[0];
  for (const s of sorted) {
    if (daysSincePlanting >= s.startDay) def = s;
    else break;
  }

  const daysToHarvest = Math.max(0, crop.daysToHarvest - daysSincePlanting);

  return {
    stage: def.stage,
    def,
    daysSincePlanting,
    daysToHarvest,
  };
}
