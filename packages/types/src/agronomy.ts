// @teranode/types — crop library + agronomy engine vocabulary.
// This is the canonical home so BOTH @teranode/agronomy and the clients import
// these from here (spec §3 + §4). Keep dependency-free and pure data.

/** Crop family/category. */
export type CropCategory =
  | 'fruiting'
  | 'leafy'
  | 'root'
  | 'bulb'
  | 'legume'
  | 'brassica';

/** Lifecycle stages. Leafy/root crops may skip flowering/fruiting. */
export type GrowthStage =
  | 'germination'
  | 'vegetative'
  | 'flowering'
  | 'fruiting'
  | 'harvest';

/**
 * Agronomy channel keys (engine-facing, camelCase). These differ from the raw DB
 * `ChannelType` enum (which is lowercase/short, e.g. `soiltemp`). The mapping
 * between the two lives in CHANNEL_DB_MAP / CHANNEL_ENGINE_MAP below.
 */
export type Channel =
  | 'moisture'
  | 'ph'
  | 'ec'
  | 'n'
  | 'p'
  | 'k'
  | 'soilTemp'
  | 'airTemp';

/** [low, high] inclusive band. */
export type Range = [number, number];

/** A full set of agronomic target bands for one stage (or whole crop). */
export interface CropBand {
  moisture: Range;
  ph: Range;
  ec: Range;
  n: Range;
  p: Range;
  k: Range;
  soilTemp: Range;
  airTemp: Range;
}

/** A single growth-stage definition with its ideal + acceptable bands. */
export interface CropStageDef {
  stage: GrowthStage;
  ordinal: number;
  /** Day-since-planting at which this stage begins. */
  startDay: number;
  ideal: CropBand;
  acceptable: CropBand;
}

/** A full crop definition from the 14-crop library. */
export interface Crop {
  id: string;
  nameEn: string;
  nameNe: string;
  emoji: string;
  category: CropCategory;
  daysToHarvest: number;
  wateringNotesEn: string;
  wateringNotesNe: string;
  ideal: CropBand;
  acceptable: CropBand;
  stages: CropStageDef[];
}

// --- engine result types ------------------------------------------------------

/** Where a reading sits relative to its band. */
export type BandStatus = 'below' | 'in' | 'above' | 'unknown';

/** Per-channel evaluation result. */
export interface ChannelStatus {
  channel: Channel;
  value: number | null;
  status: BandStatus;
  idealRange: Range;
  acceptableRange: Range;
  /**
   * Signed distance from the nearest ideal edge in channel units: negative when
   * below the ideal low, positive when above the ideal high, 0 when in-band.
   */
  deviation: number;
}

/** Aggregate zone health: 0–100 score + the per-channel breakdown. */
export interface HealthResult {
  score: number;
  perChannel: ChannelStatus[];
}

/** Suggested corrective actions emitted by the engine. */
export type RecommendationAction =
  | 'increase_dosing'
  | 'decrease_dosing'
  | 'irrigate'
  | 'hold_water'
  | 'ph_up'
  | 'ph_down'
  | 'wait';

/** A bilingual coaching recommendation tied to one channel. */
export interface Recommendation {
  channel: Channel;
  severity: 'info' | 'warn' | 'critical';
  messageEn: string;
  messageNe: string;
  action: RecommendationAction;
}

/** The crop rule derived from a crop+stage band. */
export interface DerivedRule {
  moistureLow: number;
  moistureHigh: number;
  phTarget: number;
  ecTarget: number;
}

/** Result of `currentStage(crop, plantingDate, now?)`. */
export interface CurrentStageResult {
  stage: GrowthStage;
  def: CropStageDef;
  daysSincePlanting: number;
  daysToHarvest: number;
}

/** Readings keyed by engine channel name. */
export type ChannelReadings = Partial<Record<Channel, number>>;

/** Full analysis of one zone, returned by `analyzeZone(...)` and the API. */
export interface ZoneAnalysis {
  stage: GrowthStage;
  daysSincePlanting: number;
  health: HealthResult;
  channels: ChannelStatus[];
  recommendations: Recommendation[];
  rule: DerivedRule;
}

/** Locale for bilingual outputs. */
export type Locale = 'en' | 'ne';

// --- channel name mapping (DB <-> engine) ------------------------------------

/** Map an engine channel name to its raw DB `channel_type` value. */
export const CHANNEL_DB_MAP: Readonly<Record<Channel, string>> = {
  moisture: 'moisture',
  ph: 'ph',
  ec: 'ec',
  n: 'n',
  p: 'p',
  k: 'k',
  soilTemp: 'soiltemp',
  airTemp: 'airtemp',
};

/** Map a raw DB `channel_type` value to its engine channel name (where one exists). */
export const CHANNEL_ENGINE_MAP: Readonly<Record<string, Channel>> = {
  moisture: 'moisture',
  ph: 'ph',
  ec: 'ec',
  n: 'n',
  p: 'p',
  k: 'k',
  soiltemp: 'soilTemp',
  airtemp: 'airTemp',
};

/** The eight engine channels in canonical order. */
export const ENGINE_CHANNELS: readonly Channel[] = [
  'moisture',
  'ph',
  'ec',
  'n',
  'p',
  'k',
  'soilTemp',
  'airTemp',
];

/** Default health weights (spec §4) — renormalized over channels present. */
export const HEALTH_WEIGHTS: Readonly<Record<Channel, number>> = {
  moisture: 0.3,
  ph: 0.15,
  ec: 0.15,
  n: 0.1,
  p: 0.1,
  k: 0.1,
  soilTemp: 0.05,
  airTemp: 0.05,
};
