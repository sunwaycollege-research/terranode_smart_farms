// Rule derivation: turn a crop+stage band into the concrete irrigation/dosing
// rule the controller uses (moisture low/high thresholds + pH and EC targets).
//
// moistureLow / moistureHigh come straight from the stage's ideal moisture band.
// phTarget / ecTarget are the midpoints of the stage's ideal pH / EC bands —
// the controller drives toward the centre of the acceptable range.

import type { Crop, CropStageDef, DerivedRule, GrowthStage, Range } from '@teranode/types';

const mid = ([lo, hi]: Range): number => Math.round(((lo + hi) / 2) * 100) / 100;

/** Find a crop's stage def by stage name (falls back to the first stage). */
function stageDef(crop: Crop, stage: GrowthStage): CropStageDef {
  return crop.stages.find((s) => s.stage === stage) ?? crop.stages[0];
}

/**
 * Derive the controller rule for a crop at a given growth stage. Accepts either
 * a `GrowthStage` name or a concrete `CropStageDef`.
 */
export function deriveRule(
  crop: Crop,
  stage: GrowthStage | CropStageDef,
): DerivedRule {
  const def: CropStageDef =
    typeof stage === 'string' ? stageDef(crop, stage) : stage;
  const band = def.ideal;
  return {
    moistureLow: band.moisture[0],
    moistureHigh: band.moisture[1],
    phTarget: mid(band.ph),
    ecTarget: mid(band.ec),
  };
}
