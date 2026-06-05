import { describe, it, expect } from 'vitest';
import { channelScore, zoneHealth } from './health';
import type { CropBand } from '@teranode/types';
import { HEALTH_WEIGHTS } from '@teranode/types';

const ideal: [number, number] = [60, 80]; // width 20
const acceptable: [number, number] = [50, 90]; // gap 10 each side

describe('channelScore — piecewise curve (spec §4)', () => {
  it('is 1.0 anywhere inside the ideal band', () => {
    expect(channelScore(60, ideal, acceptable)).toBe(1);
    expect(channelScore(70, ideal, acceptable)).toBe(1);
    expect(channelScore(80, ideal, acceptable)).toBe(1);
  });

  it('decays linearly 1.0 → 0.5 across the ideal→acceptable gap (low side)', () => {
    // halfway between ideal low (60) and acceptable low (50) → 55 → 0.75
    expect(channelScore(55, ideal, acceptable)).toBeCloseTo(0.75, 5);
    // at the acceptable low edge → 0.5
    expect(channelScore(50, ideal, acceptable)).toBeCloseTo(0.5, 5);
  });

  it('decays linearly 1.0 → 0.5 across the ideal→acceptable gap (high side)', () => {
    expect(channelScore(85, ideal, acceptable)).toBeCloseTo(0.75, 5);
    expect(channelScore(90, ideal, acceptable)).toBeCloseTo(0.5, 5);
  });

  it('decays 0.5 → 0.0 over one ideal-width beyond the acceptable edge', () => {
    // ideal width = 20; one width below acceptable low (50) is 30 → score 0
    expect(channelScore(50, ideal, acceptable)).toBeCloseTo(0.5, 5);
    expect(channelScore(40, ideal, acceptable)).toBeCloseTo(0.25, 5); // halfway
    expect(channelScore(30, ideal, acceptable)).toBeCloseTo(0, 5); // floor
    // and the symmetric high side
    expect(channelScore(100, ideal, acceptable)).toBeCloseTo(0.25, 5);
    expect(channelScore(110, ideal, acceptable)).toBeCloseTo(0, 5);
  });

  it('floors at 0 far past the acceptable edge (never negative)', () => {
    expect(channelScore(0, ideal, acceptable)).toBe(0);
    expect(channelScore(1000, ideal, acceptable)).toBe(0);
  });

  it('stays within [0,1] for a sweep of values', () => {
    for (let v = -50; v <= 200; v += 0.5) {
      const s = channelScore(v, ideal, acceptable);
      expect(s).toBeGreaterThanOrEqual(0);
      expect(s).toBeLessThanOrEqual(1);
    }
  });
});

const band: CropBand = {
  moisture: [60, 75], ph: [6, 6.8], ec: [2, 3.5], n: [100, 150],
  p: [40, 60], k: [150, 250], soilTemp: [18, 26], airTemp: [20, 28],
};
const accept: CropBand = {
  moisture: [55, 80], ph: [5.5, 7.3], ec: [1.7, 3.8], n: [85, 165],
  p: [35, 65], k: [130, 270], soilTemp: [16, 28], airTemp: [18, 30],
};

describe('zoneHealth — aggregate score', () => {
  it('is exactly 100 when every channel sits in its ideal band', () => {
    const r = zoneHealth(band, accept, {
      moisture: 67, ph: 6.4, ec: 2.7, n: 125, p: 50, k: 200, soilTemp: 22, airTemp: 24,
    });
    expect(r.score).toBe(100);
    expect(r.perChannel).toHaveLength(8);
    expect(r.perChannel.every((c) => c.status === 'in')).toBe(true);
  });

  it('score is bounded 0..100 across many random reading sets', () => {
    for (let i = 0; i < 200; i++) {
      const readings = {
        moisture: Math.random() * 120,
        ph: Math.random() * 14,
        ec: Math.random() * 8,
        n: Math.random() * 400,
        p: Math.random() * 200,
        k: Math.random() * 600,
        soilTemp: Math.random() * 50,
        airTemp: Math.random() * 50,
      };
      const r = zoneHealth(band, accept, readings);
      expect(r.score).toBeGreaterThanOrEqual(0);
      expect(r.score).toBeLessThanOrEqual(100);
      expect(Number.isInteger(r.score)).toBe(true);
    }
  });

  it('returns 0 when no channel has a reading', () => {
    const r = zoneHealth(band, accept, {});
    expect(r.score).toBe(0);
    expect(r.perChannel.every((c) => c.status === 'unknown')).toBe(true);
  });

  it('renormalizes weights over channels actually present', () => {
    // only moisture present and in-band → score should be 100 (full weight)
    const r = zoneHealth(band, accept, { moisture: 67 });
    expect(r.score).toBe(100);
  });

  it('a single far-out channel drags the score down proportional to its weight', () => {
    // moisture (weight .30) crashed to 0, everything else perfect.
    const r = zoneHealth(band, accept, {
      moisture: 0, ph: 6.4, ec: 2.7, n: 125, p: 50, k: 200, soilTemp: 22, airTemp: 24,
    });
    // expected = (sum of all weights - 0.30) / sum of all weights
    const total = Object.values(HEALTH_WEIGHTS).reduce((a, b) => a + b, 0);
    const expected = Math.round((100 * (total - HEALTH_WEIGHTS.moisture)) / total);
    expect(r.score).toBe(expected);
  });

  it('drops missing channels from the denominator (NaN treated as missing)', () => {
    const partial = zoneHealth(band, accept, { moisture: 67, ph: 6.4 });
    const withNaN = zoneHealth(band, accept, {
      moisture: 67, ph: 6.4, ec: NaN as unknown as number,
    });
    expect(partial.score).toBe(100);
    expect(withNaN.score).toBe(100);
  });

  it('matches a hand-computed weighted mean for a mixed case', () => {
    // moisture in-band (1.0), ph at acceptable low edge (0.5), others missing.
    const r = zoneHealth(band, accept, { moisture: 67, ph: 5.5 });
    const wM = HEALTH_WEIGHTS.moisture;
    const wP = HEALTH_WEIGHTS.ph;
    const expected = Math.round((100 * (wM * 1 + wP * 0.5)) / (wM + wP));
    expect(r.score).toBe(expected);
  });
});
