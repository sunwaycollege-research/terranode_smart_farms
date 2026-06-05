// The 14-crop library (spec §3). Each crop module exports a fully-built `Crop`
// (whole-crop bands + a derived stage timeline). This index aggregates them into
// an ordered list and an id→crop map, and re-exports the band/builder helpers.

import type { Crop } from '@teranode/types';
import { tomato } from './tomato';
import { capsicum } from './capsicum';
import { chili } from './chili';
import { cucumber } from './cucumber';
import { spinach } from './spinach';
import { lettuce } from './lettuce';
import { cabbage } from './cabbage';
import { cauliflower } from './cauliflower';
import { onion } from './onion';
import { carrot } from './carrot';
import { potato } from './potato';
import { eggplant } from './eggplant';
import { okra } from './okra';
import { beans } from './beans';

export { widen, widenBand, stageIdeal } from './bands';
export { buildCrop } from './builder';
export type { CropSpec, StageSpec } from './builder';

export {
  tomato,
  capsicum,
  chili,
  cucumber,
  spinach,
  lettuce,
  cabbage,
  cauliflower,
  onion,
  carrot,
  potato,
  eggplant,
  okra,
  beans,
};

/** All 14 crops in catalog order. */
export const CROPS: readonly Crop[] = [
  tomato,
  capsicum,
  chili,
  cucumber,
  spinach,
  lettuce,
  cabbage,
  cauliflower,
  onion,
  carrot,
  potato,
  eggplant,
  okra,
  beans,
];

/** id → crop lookup map. */
export const CROP_BY_ID: Readonly<Record<string, Crop>> = Object.freeze(
  Object.fromEntries(CROPS.map((c) => [c.id, c])),
);

/** Look up a crop by its slug id; returns `undefined` if unknown. */
export function getCrop(id: string): Crop | undefined {
  return CROP_BY_ID[id];
}
