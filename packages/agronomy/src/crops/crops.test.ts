import { describe, it, expect } from 'vitest';
import {
  CROPS,
  CROP_BY_ID,
  getCrop,
  tomato,
  capsicum,
  spinach,
  cucumber,
} from './index';
import { widen, widenBand, stageIdeal } from './bands';
import type { Channel, Crop, GrowthStage } from '@teranode/types';
import { ENGINE_CHANNELS } from '@teranode/types';

const EXPECTED_IDS = [
  'tomato', 'capsicum', 'chili', 'cucumber', 'spinach', 'lettuce',
  'cabbage', 'cauliflower', 'onion', 'carrot', 'potato', 'eggplant',
  'okra', 'beans',
];

const FRUITING_PIPELINE: GrowthStage[] = ['germination', 'vegetative', 'flowering', 'fruiting'];

describe('crop library — registry', () => {
  it('contains exactly the 14 spec crops', () => {
    expect(CROPS).toHaveLength(14);
    expect(CROPS.map((c) => c.id).sort()).toEqual([...EXPECTED_IDS].sort());
  });

  it('CROP_BY_ID and getCrop resolve each crop', () => {
    for (const id of EXPECTED_IDS) {
      expect(CROP_BY_ID[id]?.id).toBe(id);
      expect(getCrop(id)?.id).toBe(id);
    }
    expect(getCrop('does-not-exist')).toBeUndefined();
  });

  it('every crop has bilingual names, an emoji and a category', () => {
    for (const c of CROPS) {
      expect(c.nameEn.length).toBeGreaterThan(0);
      expect(c.nameNe.length).toBeGreaterThan(0);
      expect(c.emoji.length).toBeGreaterThan(0);
      expect(c.wateringNotesEn.length).toBeGreaterThan(0);
      expect(c.wateringNotesNe.length).toBeGreaterThan(0);
      expect(c.daysToHarvest).toBeGreaterThan(0);
    }
  });
});

function assertBandValid(band: Record<Channel, [number, number]>) {
  for (const ch of ENGINE_CHANNELS) {
    const [lo, hi] = band[ch];
    expect(lo).toBeLessThanOrEqual(hi);
    expect(Number.isFinite(lo)).toBe(true);
    expect(Number.isFinite(hi)).toBe(true);
  }
}

describe('crop library — bands & stages', () => {
  it('every crop ideal band is well-formed (low <= high on all channels)', () => {
    for (const c of CROPS) assertBandValid(c.ideal as any);
  });

  it('acceptable band is wider than (or equal to) ideal on every channel', () => {
    for (const c of CROPS) {
      for (const ch of ENGINE_CHANNELS) {
        const [iLo, iHi] = c.ideal[ch];
        const [aLo, aHi] = c.acceptable[ch];
        expect(aLo).toBeLessThanOrEqual(iLo);
        expect(aHi).toBeGreaterThanOrEqual(iHi);
        expect(aHi - aLo).toBeGreaterThan(iHi - iLo);
      }
    }
  });

  it('stages have ascending ordinals and non-decreasing startDays', () => {
    for (const c of CROPS) {
      expect(c.stages.length).toBeGreaterThanOrEqual(2);
      c.stages.forEach((s, i) => {
        expect(s.ordinal).toBe(i);
        if (i > 0) {
          expect(s.startDay).toBeGreaterThan(c.stages[i - 1].startDay);
        }
      });
      expect(c.stages[0].startDay).toBe(0);
    }
  });

  it('each stage carries a valid ideal + acceptable band', () => {
    for (const c of CROPS) {
      for (const s of c.stages) {
        assertBandValid(s.ideal as any);
        assertBandValid(s.acceptable as any);
      }
    }
  });

  it('leafy / root / bulb crops skip flowering & fruiting', () => {
    const skipCats = new Set(['leafy', 'root', 'bulb', 'brassica']);
    for (const c of CROPS) {
      if (!skipCats.has(c.category)) continue;
      const names = c.stages.map((s) => s.stage);
      expect(names).not.toContain('flowering');
      expect(names).not.toContain('fruiting');
    }
  });

  it('fruiting & legume crops include flowering & fruiting', () => {
    for (const c of CROPS) {
      if (c.category !== 'fruiting' && c.category !== 'legume') continue;
      const names = c.stages.map((s) => s.stage);
      for (const stage of FRUITING_PIPELINE) {
        expect(names).toContain(stage);
      }
    }
  });
});

describe('fully-specified crops match spec §3 numbers exactly', () => {
  it('tomato whole-crop ideal', () => {
    expect(tomato.daysToHarvest).toBe(110);
    expect(tomato.category).toBe('fruiting');
    expect(tomato.ideal.moisture).toEqual([60, 75]);
    expect(tomato.ideal.ph).toEqual([6.0, 6.8]);
    expect(tomato.ideal.ec).toEqual([2.0, 3.5]);
    expect(tomato.ideal.n).toEqual([100, 150]);
    expect(tomato.ideal.p).toEqual([40, 60]);
    expect(tomato.ideal.k).toEqual([150, 250]);
    expect(tomato.ideal.soilTemp).toEqual([18, 26]);
    expect(tomato.ideal.airTemp).toEqual([20, 28]);
  });

  it('tomato stage start days and overrides', () => {
    const byStage = Object.fromEntries(tomato.stages.map((s) => [s.stage, s]));
    expect(byStage.germination.startDay).toBe(0);
    expect(byStage.germination.ideal.moisture).toEqual([65, 80]);
    expect(byStage.germination.ideal.ec).toEqual([1.0, 1.5]);
    expect(byStage.vegetative.startDay).toBe(21);
    expect(byStage.flowering.startDay).toBe(45);
    expect(byStage.fruiting.startDay).toBe(65);
    expect(byStage.fruiting.ideal.k).toEqual([200, 280]);
    expect(byStage.harvest.startDay).toBe(95);
    // a channel NOT overridden in a stage inherits the whole-crop ideal
    expect(byStage.fruiting.ideal.ph).toEqual(tomato.ideal.ph);
  });

  it('capsicum / spinach / cucumber spec basics', () => {
    expect(capsicum.daysToHarvest).toBe(100);
    expect(capsicum.ideal.moisture).toEqual([55, 70]);
    expect(spinach.category).toBe('leafy');
    expect(spinach.daysToHarvest).toBe(45);
    expect(spinach.stages.map((s) => s.stage)).toEqual([
      'germination', 'vegetative', 'harvest',
    ]);
    expect(cucumber.daysToHarvest).toBe(60);
    expect(cucumber.ideal.ph).toEqual([5.8, 6.8]);
  });
});

describe('band helpers', () => {
  it('widen() widens by a fraction of width, clamps to physical limits', () => {
    expect(widen('n', [100, 150], 0.25)).toEqual([87.5, 162.5]);
    // moisture cannot exceed 100 or go below 0
    expect(widen('moisture', [90, 98], 0.5)).toEqual([86, 100]);
    expect(widen('moisture', [2, 10], 0.5)).toEqual([0, 14]);
  });

  it('widen() uses an additive margin for pH', () => {
    expect(widen('ph', [6.0, 6.8])).toEqual([5.5, 7.3]);
  });

  it('widenBand widens every channel', () => {
    const wb = widenBand(tomato.ideal);
    for (const ch of ENGINE_CHANNELS) {
      expect(wb[ch][0]).toBeLessThanOrEqual(tomato.ideal[ch][0]);
      expect(wb[ch][1]).toBeGreaterThanOrEqual(tomato.ideal[ch][1]);
    }
  });

  it('stageIdeal merges overrides over the crop ideal', () => {
    const merged = stageIdeal(tomato.ideal, { moisture: [10, 20] });
    expect(merged.moisture).toEqual([10, 20]);
    expect(merged.ph).toEqual(tomato.ideal.ph);
  });
});
