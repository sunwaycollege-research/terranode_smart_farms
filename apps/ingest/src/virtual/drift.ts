// Pure simulation core for the virtual gateway (no I/O).
//
// This re-creates the legacy `driftZones` hysteresis behaviour so the whole
// stack runs hardware-free:
//   - while a zone's valve is OPEN, soil moisture rises (~+1.2%/tick);
//     while CLOSED it falls (~-0.5%/tick); moisture is clamped to 8..96.
//   - in `auto` mode the valve OPENS when moisture < rule.moistureLow and
//     CLOSES when moisture > rule.moistureHigh (classic two-threshold
//     hysteresis — it holds its state between the thresholds).
//   - in `manual` mode the valve obeys whatever `valve` the caller forced.
//   - the farm pump is ON if ANY zone valve is open.
//   - the remaining channels (ph/ec/n/p/k/soilTemp) jitter around a per-zone
//     baseline within plausible bands.
//
// Everything here is deterministic given its inputs except the small random
// jitter, which is injected via an `rng` so callers/tests can make it
// repeatable. Keep this module free of mqtt/pg imports.

/** Per-zone hysteresis rule (moisture thresholds, %). */
export interface ZoneRule {
  moistureLow: number;
  moistureHigh: number;
}

/** Mutable per-zone simulation state, held in memory between ticks. */
export interface ZoneSimState {
  zoneId: string;
  cropId: string | null;
  /** 'auto' = rule-driven hysteresis; 'manual' = valve forced by command. */
  mode: string;
  rule: ZoneRule;
  /** Soil moisture %, the value that drifts each tick. */
  moisture: number;
  /** Whether the zone irrigation valve is currently open. */
  valve: boolean;
  /** Slow-moving nutrient/soil baselines (jittered around each tick). */
  ph: number;
  ec: number;
  n: number;
  p: number;
  k: number;
  soilTemp: number;
}

/** Moisture clamp bounds (%) — matches the legacy simulator. */
export const MOISTURE_MIN = 8;
export const MOISTURE_MAX = 96;

/** Moisture deltas per tick. */
export const MOISTURE_RISE = 1.2; // valve open → wetter
export const MOISTURE_FALL = 0.5; // valve closed → drier

const clamp = (v: number, lo: number, hi: number): number =>
  v < lo ? lo : v > hi ? hi : v;

/**
 * Nudge `value` toward `center` and add bounded random jitter, then clamp to
 * [min,max]. Used for the slowly-wandering nutrient/soil channels so they hover
 * around a plausible baseline rather than random-walking away.
 */
function wander(
  value: number,
  center: number,
  pull: number,
  jitter: number,
  min: number,
  max: number,
  rng: () => number,
): number {
  const toward = value + (center - value) * pull;
  const noise = (rng() * 2 - 1) * jitter;
  return clamp(toward + noise, min, max);
}

/**
 * Advance a single zone one tick in place. Applies the moisture drift +
 * hysteresis valve logic and jitters the secondary channels.
 *
 * Returns whether the valve is open *after* this tick (so the caller can fold
 * it into the farm-pump decision and emit usage while open).
 */
export function driftZone(z: ZoneSimState, rng: () => number = Math.random): boolean {
  // 1) moisture drifts according to the *current* valve position.
  const delta = z.valve ? MOISTURE_RISE : -MOISTURE_FALL;
  // small jitter on the drift so the curve isn't a perfect ramp.
  const jitter = (rng() * 2 - 1) * 0.15;
  z.moisture = clamp(z.moisture + delta + jitter, MOISTURE_MIN, MOISTURE_MAX);

  // 2) hysteresis valve control (auto mode only).
  if (z.mode === 'auto') {
    if (z.moisture < z.rule.moistureLow) {
      z.valve = true;
    } else if (z.moisture > z.rule.moistureHigh) {
      z.valve = false;
    }
    // between the thresholds → hold current state (this is the hysteresis).
  }
  // manual mode: leave z.valve exactly as set by the last command.

  // 3) jitter the secondary channels around their baselines.
  z.ph = round1(wander(z.ph, 6.4, 0.05, 0.06, 5.5, 7.2, rng));
  z.ec = round2(wander(z.ec, 2.0, 0.05, 0.05, 0.8, 3.4, rng));
  z.n = Math.round(wander(z.n, z.n, 0, 4, 30, 220, rng));
  z.p = Math.round(wander(z.p, z.p, 0, 2.5, 25, 80, rng));
  z.k = Math.round(wander(z.k, z.k, 0, 4, 110, 300, rng));
  z.soilTemp = round1(wander(z.soilTemp, 21, 0.04, 0.25, 8, 34, rng));

  return z.valve;
}

/**
 * Advance every zone one tick and return the derived farm pump state
 * (ON iff any valve is open). Mutates each zone in place.
 */
export function driftZones(
  zones: ZoneSimState[],
  rng: () => number = Math.random,
): { pump: boolean } {
  let anyOpen = false;
  for (const z of zones) {
    if (driftZone(z, rng)) anyOpen = true;
  }
  return { pump: anyOpen };
}

const round1 = (v: number): number => Math.round(v * 10) / 10;
const round2 = (v: number): number => Math.round(v * 100) / 100;
