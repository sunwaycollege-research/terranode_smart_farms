// Zone health: per-channel score curve + the weighted mean from spec §4.
//
// Per-channel score s ∈ [0,1]:
//   • in the ideal band                      → 1.0
//   • in acceptable but outside ideal        → linear 1.0 → 0.5 across the gap
//                                              between the ideal edge and the
//                                              acceptable edge on that side
//   • beyond the acceptable edge             → 0.5 → 0.0 decaying linearly over
//                                              ONE ideal-width past that edge
//                                              (floor 0)
//
// score = round( 100 * Σ wᵢ·sᵢ / Σ wᵢ ), weights renormalized over the channels
// that actually have a reading (missing channels are dropped from both sums).

import type {
  Channel,
  ChannelReadings,
  ChannelStatus,
  CropBand,
  HealthResult,
  Range,
} from '@teranode/types';
import { ENGINE_CHANNELS, HEALTH_WEIGHTS } from '@teranode/types';
import { evaluateChannelsWithAcceptable } from './status';

const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));

function unionRange(ideal: Range, acceptable: Range): Range {
  return [Math.min(ideal[0], acceptable[0]), Math.max(ideal[1], acceptable[1])];
}

/**
 * Score one reading against its ideal + acceptable ranges following the spec §4
 * piecewise curve. Returns a value in [0,1]. The two edges (low/high) are scored
 * independently; only the violated edge matters.
 */
export function channelScore(
  value: number,
  ideal: Range,
  acceptable: Range,
): number {
  const [iLo, iHi] = ideal;
  const [aLo, aHi] = unionRange(ideal, acceptable);
  const idealWidth = Math.max(iHi - iLo, 1e-9);

  // In the ideal band → perfect.
  if (value >= iLo && value <= iHi) return 1;

  if (value < iLo) {
    // Below ideal low.
    const gap = Math.max(iLo - aLo, 1e-9); // acceptable→ideal gap on the low side
    if (value >= aLo) {
      // Within acceptable: linear 1.0 (at iLo) → 0.5 (at aLo).
      const t = (iLo - value) / gap; // 0 at iLo, 1 at aLo
      return clamp01(1 - 0.5 * t);
    }
    // Beyond acceptable low edge: 0.5 → 0.0 over one ideal-width past aLo.
    const t = (aLo - value) / idealWidth; // 0 at aLo, 1 one ideal-width below
    return clamp01(0.5 - 0.5 * t);
  }

  // Above ideal high.
  const gap = Math.max(aHi - iHi, 1e-9);
  if (value <= aHi) {
    const t = (value - iHi) / gap; // 0 at iHi, 1 at aHi
    return clamp01(1 - 0.5 * t);
  }
  const t = (value - aHi) / idealWidth; // 0 at aHi, 1 one ideal-width above
  return clamp01(0.5 - 0.5 * t);
}

/**
 * Compute aggregate zone health from an ideal band, its wider acceptable band,
 * and a (possibly partial) reading set. Channels without a reading are excluded
 * from the weighted mean (weights renormalized over present channels). When no
 * channel has a reading at all, score is 0.
 */
export function zoneHealth(
  ideal: CropBand,
  acceptable: CropBand,
  readings: ChannelReadings,
): HealthResult {
  const perChannel: ChannelStatus[] = evaluateChannelsWithAcceptable(
    ideal,
    acceptable,
    readings,
  );

  let weighted = 0;
  let totalWeight = 0;
  for (const ch of ENGINE_CHANNELS as readonly Channel[]) {
    const v = readings[ch];
    if (v === undefined || v === null || Number.isNaN(v)) continue;
    const w = HEALTH_WEIGHTS[ch];
    const s = channelScore(v, ideal[ch], acceptable[ch]);
    weighted += w * s;
    totalWeight += w;
  }

  const score = totalWeight === 0 ? 0 : Math.round((100 * weighted) / totalWeight);
  return { score, perChannel };
}
