import { describe, it, expect } from 'vitest';
import { recommendations } from './recommend';
import { evaluateChannelsWithAcceptable } from './status';
import { tomato } from '../crops/index';
import type { ChannelReadings, CropBand, GrowthStage } from '@teranode/types';

const ideal: CropBand = tomato.stages.find((s) => s.stage === 'fruiting')!.ideal;
const accept: CropBand = tomato.stages.find((s) => s.stage === 'fruiting')!.acceptable;

function recsFor(readings: ChannelReadings, stage: GrowthStage = 'fruiting') {
  const statuses = evaluateChannelsWithAcceptable(ideal, accept, readings);
  return recommendations(tomato, stage, statuses);
}

describe('recommendations — spec §4 examples', () => {
  it('N below during a high-demand stage → increase_dosing', () => {
    const recs = recsFor({ n: 50 }, 'fruiting');
    const n = recs.find((r) => r.channel === 'n')!;
    expect(n.action).toBe('increase_dosing');
    expect(n.severity).toBe('warn'); // fruiting is high-demand
    expect(n.messageEn).toContain('increase nutrient dosing');
    expect(n.messageEn).toContain('fruiting');
    expect(n.messageNe.length).toBeGreaterThan(0);
  });

  it('pH above → ph_down', () => {
    const recs = recsFor({ ph: 7.5 });
    const ph = recs.find((r) => r.channel === 'ph')!;
    expect(ph.action).toBe('ph_down');
  });

  it('pH below → ph_up', () => {
    const recs = recsFor({ ph: 5.0 });
    const ph = recs.find((r) => r.channel === 'ph')!;
    expect(ph.action).toBe('ph_up');
  });

  it('moisture below → irrigate', () => {
    const recs = recsFor({ moisture: 40 });
    const m = recs.find((r) => r.channel === 'moisture')!;
    expect(m.action).toBe('irrigate');
  });

  it('moisture above → hold_water', () => {
    const recs = recsFor({ moisture: 95 });
    const m = recs.find((r) => r.channel === 'moisture')!;
    expect(m.action).toBe('hold_water');
  });

  it('EC above → decrease_dosing', () => {
    const recs = recsFor({ ec: 5 });
    const ec = recs.find((r) => r.channel === 'ec')!;
    expect(ec.action).toBe('decrease_dosing');
  });
});

describe('recommendations — coverage & shape', () => {
  it('emits BOTH messageEn and messageNe for every recommendation', () => {
    const recs = recsFor({ moisture: 40, ph: 7.5, ec: 5, n: 50, p: 20, k: 100 });
    expect(recs.length).toBeGreaterThan(0);
    for (const r of recs) {
      expect(r.messageEn.length).toBeGreaterThan(0);
      expect(r.messageNe.length).toBeGreaterThan(0);
      expect(['info', 'warn', 'critical']).toContain(r.severity);
    }
  });

  it('produces no recommendations when every channel is in-band', () => {
    const recs = recsFor({
      moisture: 70, ph: 6.4, ec: 3.0, n: 115, p: 50, k: 240, soilTemp: 22, airTemp: 24,
    });
    expect(recs).toEqual([]);
  });

  it('ignores unknown (missing) channels', () => {
    const recs = recsFor({ moisture: 40 });
    // only moisture should yield a rec; nothing for the missing channels
    expect(recs).toHaveLength(1);
    expect(recs[0].channel).toBe('moisture');
  });

  it('N below in germination (low-demand) is info, not warn', () => {
    const recs = recsFor({ n: 30 }, 'germination');
    const n = recs.find((r) => r.channel === 'n')!;
    expect(n.action).toBe('increase_dosing');
    expect(n.severity).toBe('info');
  });

  it('EC below → increase_dosing', () => {
    const recs = recsFor({ ec: 0.5 });
    const ec = recs.find((r) => r.channel === 'ec')!;
    expect(ec.action).toBe('increase_dosing');
  });

  it('temperature out of band → wait (advisory)', () => {
    const recs = recsFor({ soilTemp: 5, airTemp: 40 });
    const soil = recs.find((r) => r.channel === 'soilTemp')!;
    const air = recs.find((r) => r.channel === 'airTemp')!;
    expect(soil.action).toBe('wait');
    expect(air.action).toBe('wait');
  });

  it('sorts critical/warn before info', () => {
    const recs = recsFor({ moisture: 40, soilTemp: 5 });
    // moisture below = warn, soilTemp = info → warn first
    const ranks = recs.map((r) => r.severity);
    const warnIdx = ranks.indexOf('warn');
    const infoIdx = ranks.indexOf('info');
    expect(warnIdx).toBeLessThan(infoIdx);
  });
});
