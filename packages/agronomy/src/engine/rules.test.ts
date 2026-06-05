import { describe, it, expect } from 'vitest';
import { deriveRule } from './rules';
import { tomato, spinach } from '../crops/index';

describe('deriveRule', () => {
  it('takes moisture thresholds straight from the stage ideal band', () => {
    const fruiting = tomato.stages.find((s) => s.stage === 'fruiting')!;
    const rule = deriveRule(tomato, fruiting);
    expect(rule.moistureLow).toBe(fruiting.ideal.moisture[0]);
    expect(rule.moistureHigh).toBe(fruiting.ideal.moisture[1]);
  });

  it('uses the midpoint of the ideal pH and EC bands as targets', () => {
    const fruiting = tomato.stages.find((s) => s.stage === 'fruiting')!;
    const rule = deriveRule(tomato, fruiting);
    const [pLo, pHi] = fruiting.ideal.ph;
    const [eLo, eHi] = fruiting.ideal.ec;
    expect(rule.phTarget).toBeCloseTo((pLo + pHi) / 2, 2);
    expect(rule.ecTarget).toBeCloseTo((eLo + eHi) / 2, 2);
  });

  it('accepts a stage name as well as a stage def', () => {
    const byName = deriveRule(tomato, 'vegetative');
    const def = tomato.stages.find((s) => s.stage === 'vegetative')!;
    const byDef = deriveRule(tomato, def);
    expect(byName).toEqual(byDef);
  });

  it('different stages derive different moisture thresholds', () => {
    const germ = deriveRule(tomato, 'germination'); // moisture 65–80
    const harvest = deriveRule(tomato, 'harvest'); // moisture 55–70
    expect(germ.moistureLow).toBe(65);
    expect(harvest.moistureLow).toBe(55);
  });

  it('falls back to the first stage for an unknown stage name', () => {
    const r = deriveRule(spinach, 'flowering'); // spinach has no flowering
    const first = deriveRule(spinach, spinach.stages[0]);
    expect(r).toEqual(first);
  });

  it('returns finite, ordered moisture thresholds for every crop/stage', () => {
    for (const stage of tomato.stages) {
      const r = deriveRule(tomato, stage);
      expect(r.moistureLow).toBeLessThanOrEqual(r.moistureHigh);
      expect(Number.isFinite(r.phTarget)).toBe(true);
      expect(Number.isFinite(r.ecTarget)).toBe(true);
    }
  });
});
