import { describe, it, expect } from 'vitest';
import { fertilizerPlan, fertilizerSchedule } from './fertilizer';

describe('fertilizerPlan', () => {
  it('gives the crop-specific basal dose for tomato at germination', () => {
    const a = fertilizerPlan('tomato', 'germination');
    expect(a.cropId).toBe('tomato');
    expect(a.stage).toBe('germination');
    expect(a.source).toBe('TNAU');
    expect(a.doseEn.length).toBeGreaterThan(0);
    expect(a.doseNe.length).toBeGreaterThan(0);
  });

  it('flags boron for cauliflower (the key Nepal finding)', () => {
    const a = fertilizerPlan('cauliflower', 'germination');
    expect(a.doseEn.toLowerCase()).toContain('bor'); // boron/borax
  });

  it('falls back to the generic plan for an unknown crop', () => {
    const a = fertilizerPlan('dragonfruit', 'vegetative');
    expect(a.source).toBe('General');
    expect(a.titleEn.length).toBeGreaterThan(0);
  });

  it('falls back to the nearest earlier stage within a crop plan', () => {
    // potato has no 'harvest' entry → should fall back (never throw / empty)
    const a = fertilizerPlan('potato', 'harvest');
    expect(a.doseEn.length).toBeGreaterThan(0);
  });

  it('always returns bilingual advice for every stage', () => {
    const sched = fertilizerSchedule('tomato');
    expect(sched).toHaveLength(5);
    for (const a of sched) {
      expect(a.doseEn.length).toBeGreaterThan(0);
      expect(a.doseNe.length).toBeGreaterThan(0);
      expect(a.organicEn.length).toBeGreaterThan(0);
    }
  });
});
