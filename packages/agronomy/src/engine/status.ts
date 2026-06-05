// Channel banding: classify each reading as below / in / above its ideal band
// (with the wider acceptable band carried along for the health curve and UI
// ticks). Missing readings are reported as `unknown` with value null.

import type {
  Channel,
  ChannelReadings,
  ChannelStatus,
  CropBand,
  Range,
} from '@teranode/types';
import { ENGINE_CHANNELS } from '@teranode/types';

/**
 * The acceptable band per channel mirrors the ideal band shape. A crop stage's
 * acceptable band may, in principle, be narrower on one edge than its ideal (it
 * never should from the builder), so we union the two to guarantee
 * `acceptable ⊇ ideal` — this keeps the health curve monotonic.
 */
function unionRange(ideal: Range, acceptable: Range): Range {
  return [Math.min(ideal[0], acceptable[0]), Math.max(ideal[1], acceptable[1])];
}

/**
 * Evaluate one channel reading against its ideal + acceptable ranges. Status is
 * relative to the IDEAL band; deviation is the signed distance from the nearest
 * ideal edge (negative below, positive above, 0 in-band).
 */
export function evaluateChannel(
  channel: Channel,
  value: number | undefined,
  ideal: Range,
  acceptable: Range,
): ChannelStatus {
  const accept = unionRange(ideal, acceptable);
  if (value === undefined || value === null || Number.isNaN(value)) {
    return {
      channel,
      value: null,
      status: 'unknown',
      idealRange: ideal,
      acceptableRange: accept,
      deviation: 0,
    };
  }
  const [lo, hi] = ideal;
  if (value < lo) {
    return {
      channel,
      value,
      status: 'below',
      idealRange: ideal,
      acceptableRange: accept,
      deviation: value - lo, // negative
    };
  }
  if (value > hi) {
    return {
      channel,
      value,
      status: 'above',
      idealRange: ideal,
      acceptableRange: accept,
      deviation: value - hi, // positive
    };
  }
  return {
    channel,
    value,
    status: 'in',
    idealRange: ideal,
    acceptableRange: accept,
    deviation: 0,
  };
}

/**
 * Evaluate every engine channel of a crop band against a (possibly partial) set
 * of readings. Always returns all eight channels in canonical order; channels
 * with no reading come back as `unknown`.
 */
export function evaluateChannels(
  band: CropBand,
  readings: ChannelReadings,
): ChannelStatus[] {
  return ENGINE_CHANNELS.map((ch) =>
    evaluateChannel(ch, readings[ch], band[ch], band[ch]),
  );
}

/**
 * Same as `evaluateChannels` but uses an explicit acceptable band (the wider
 * stage band) for the acceptable range, while still classifying against ideal.
 */
export function evaluateChannelsWithAcceptable(
  ideal: CropBand,
  acceptable: CropBand,
  readings: ChannelReadings,
): ChannelStatus[] {
  return ENGINE_CHANNELS.map((ch) =>
    evaluateChannel(ch, readings[ch], ideal[ch], acceptable[ch]),
  );
}
