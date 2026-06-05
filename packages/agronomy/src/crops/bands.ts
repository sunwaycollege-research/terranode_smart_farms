// Band-derivation helpers for the crop library.
//
// `acceptable` is a wider band than `ideal` (≈ ±20–30%): we widen each ideal
// edge outward by a fraction of the ideal width (spec §3). pH widens additively
// (a percentage of an already-narrow range would be too tight to be useful), and
// every channel keeps a sane physical floor (e.g. moisture/temperature never go
// negative, pH stays within 0–14).

import type { CropBand, Channel, Range } from '@teranode/types';

/** Per-channel hard physical floors/ceilings the acceptable band must respect. */
const CHANNEL_LIMITS: Record<Channel, Range> = {
  moisture: [0, 100],
  ph: [3, 9.5],
  ec: [0, 12],
  n: [0, 600],
  p: [0, 400],
  k: [0, 800],
  soilTemp: [0, 50],
  airTemp: [-5, 55],
};

const clamp = (v: number, [lo, hi]: Range): number => Math.min(hi, Math.max(lo, v));

/** Round to one decimal to keep authored numbers tidy after arithmetic. */
const r1 = (v: number): number => Math.round(v * 10) / 10;

/**
 * Widen one ideal range into an acceptable range. pH widens by an absolute
 * margin (default 0.5 on each side); every other channel widens by `frac` of
 * the ideal width on each side (default 0.25 → ≈ +50% total width). Result is
 * clamped to the channel's physical limits.
 */
export function widen(
  channel: Channel,
  ideal: Range,
  frac = 0.25,
): Range {
  const [lo, hi] = ideal;
  const width = hi - lo;
  const margin = channel === 'ph' ? 0.5 : Math.max(width * frac, channel === 'ec' ? 0.3 : 1);
  const limits = CHANNEL_LIMITS[channel];
  return [r1(clamp(lo - margin, limits)), r1(clamp(hi + margin, limits))];
}

/** Build a full acceptable band by widening every channel of an ideal band. */
export function widenBand(ideal: CropBand, frac = 0.25): CropBand {
  return {
    moisture: widen('moisture', ideal.moisture, frac),
    ph: widen('ph', ideal.ph, frac),
    ec: widen('ec', ideal.ec, frac),
    n: widen('n', ideal.n, frac),
    p: widen('p', ideal.p, frac),
    k: widen('k', ideal.k, frac),
    soilTemp: widen('soilTemp', ideal.soilTemp, frac),
    airTemp: widen('airTemp', ideal.airTemp, frac),
  };
}

/**
 * Compose a stage ideal band from the whole-crop ideal plus a partial set of
 * stage-specific overrides. Channels not overridden inherit the crop ideal.
 */
export function stageIdeal(
  cropIdeal: CropBand,
  overrides: Partial<CropBand>,
): CropBand {
  return { ...cropIdeal, ...overrides };
}
