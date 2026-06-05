// TERANODE web — crops admin shared constants + helpers (unit 5.W3).
// Pure helpers over the @teranode/types Crop / CropBand shapes.

import type {
  Channel,
  CropBand,
  CropCategory,
  GrowthStage,
  Range,
} from '@teranode/types';
import { ENGINE_CHANNELS } from '@teranode/types';

/** Local locale type (mirrors useLanguage but kept dependency-light). */
export type Lang = 'en' | 'ne';

/** Display metadata for each of the 8 agronomy channels (spec §3 units). */
export interface ChannelMeta {
  key: Channel;
  label: string;
  unit: string;
  /** Sensible UI step for the numeric inputs. */
  step: number;
}

export const CHANNEL_META: readonly ChannelMeta[] = [
  { key: 'moisture', label: 'Moisture', unit: '%', step: 1 },
  { key: 'ph', label: 'pH', unit: '', step: 0.1 },
  { key: 'ec', label: 'EC', unit: 'mS/cm', step: 0.1 },
  { key: 'n', label: 'Nitrogen', unit: 'mg/kg', step: 5 },
  { key: 'p', label: 'Phosphorus', unit: 'mg/kg', step: 5 },
  { key: 'k', label: 'Potassium', unit: 'mg/kg', step: 5 },
  { key: 'soilTemp', label: 'Soil temp', unit: '°C', step: 1 },
  { key: 'airTemp', label: 'Air temp', unit: '°C', step: 1 },
];

/** Crop categories from the agronomy vocabulary (spec §3). */
export const CROP_CATEGORIES: readonly CropCategory[] = [
  'fruiting',
  'leafy',
  'root',
  'bulb',
  'legume',
  'brassica',
];

/** Lifecycle stages in canonical order. */
export const GROWTH_STAGES: readonly GrowthStage[] = [
  'germination',
  'vegetative',
  'flowering',
  'fruiting',
  'harvest',
];

const CATEGORY_LABEL: Record<CropCategory, string> = {
  fruiting: 'Fruiting',
  leafy: 'Leafy',
  root: 'Root',
  bulb: 'Bulb',
  legume: 'Legume',
  brassica: 'Brassica',
};

const STAGE_LABEL: Record<GrowthStage, string> = {
  germination: 'Germination',
  vegetative: 'Vegetative',
  flowering: 'Flowering',
  fruiting: 'Fruiting',
  harvest: 'Harvest',
};

export function categoryLabel(c: CropCategory): string {
  return CATEGORY_LABEL[c] ?? c;
}

export function stageLabel(s: GrowthStage): string {
  return STAGE_LABEL[s] ?? s;
}

/** A small emoji glyph per category for the filter chips. */
export const CATEGORY_GLYPH: Record<CropCategory, string> = {
  fruiting: '\u{1F345}',
  leafy: '\u{1F96C}',
  root: '\u{1F955}',
  bulb: '\u{1F9C5}',
  legume: '\u{1FAD8}',
  brassica: '\u{1F966}',
};

/** Default day each stage begins (used when adding a new stage row). */
export const STAGE_DEFAULT_START_DAY: Record<GrowthStage, number> = {
  germination: 0,
  vegetative: 20,
  flowering: 45,
  fruiting: 65,
  harvest: 90,
};

/** A neutral mid-range band, used as a starting point for a brand-new crop. */
export function blankBand(): CropBand {
  return {
    moisture: [60, 75],
    ph: [6.0, 6.8],
    ec: [1.5, 2.5],
    n: [100, 150],
    p: [40, 60],
    k: [150, 220],
    soilTemp: [15, 25],
    airTemp: [18, 28],
  };
}

/** Widen an ideal band by ~25% on each side to seed an acceptable band. */
export function widen(band: CropBand): CropBand {
  const out = {} as CropBand;
  for (const { key } of CHANNEL_META) {
    const [lo, hi] = band[key];
    const span = hi - lo || Math.abs(hi) * 0.2 || 1;
    out[key] = [
      round(lo - span * 0.25),
      round(hi + span * 0.25),
    ];
  }
  return out;
}

export function round(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Format a single range for compact table/summary display. */
export function fmtRange([lo, hi]: Range): string {
  return `${trim(lo)}–${trim(hi)}`;
}

function trim(n: number): string {
  // drop trailing .0 but keep meaningful decimals (e.g. pH 6.5)
  return Number.isInteger(n) ? String(n) : String(round(n));
}

/**
 * A short, human "ideal bands" summary for the library table — the 4 headline
 * channels (moisture / pH / EC / N) that growers scan first.
 */
export function bandSummary(band: CropBand): { label: string; value: string }[] {
  return [
    { label: 'Moist', value: `${fmtRange(band.moisture)}%` },
    { label: 'pH', value: fmtRange(band.ph) },
    { label: 'EC', value: fmtRange(band.ec) },
    { label: 'N', value: fmtRange(band.n) },
  ];
}

/** Deep-clone a band so editor state never mutates fetched data. */
export function cloneBand(band: CropBand): CropBand {
  const out = {} as CropBand;
  for (const { key } of CHANNEL_META) out[key] = [band[key][0], band[key][1]];
  return out;
}

/** Slugify a crop name into a stable id (lowercase, dashes). */
export function slugify(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
}

/** Re-export so consumers can iterate the canonical channel order if needed. */
export { ENGINE_CHANNELS };
