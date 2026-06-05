import { describe, it, expect } from 'vitest';
import {
  evaluateChannel,
  evaluateChannels,
  evaluateChannelsWithAcceptable,
} from './status';
import type { CropBand } from '@teranode/types';
import { ENGINE_CHANNELS } from '@teranode/types';

const ideal: [number, number] = [60, 75];
const acceptable: [number, number] = [55, 80];

describe('evaluateChannel — banding', () => {
  it('classifies a value inside the ideal band as "in" with 0 deviation', () => {
    const r = evaluateChannel('moisture', 70, ideal, acceptable);
    expect(r.status).toBe('in');
    expect(r.deviation).toBe(0);
    expect(r.value).toBe(70);
    expect(r.idealRange).toEqual(ideal);
    expect(r.acceptableRange).toEqual(acceptable);
  });

  it('classifies a value below the ideal low as "below" with negative deviation', () => {
    const r = evaluateChannel('moisture', 50, ideal, acceptable);
    expect(r.status).toBe('below');
    expect(r.deviation).toBe(-10); // 50 - 60
  });

  it('classifies a value above the ideal high as "above" with positive deviation', () => {
    const r = evaluateChannel('moisture', 90, ideal, acceptable);
    expect(r.status).toBe('above');
    expect(r.deviation).toBe(15); // 90 - 75
  });

  it('treats the ideal edges as in-band (inclusive boundaries)', () => {
    expect(evaluateChannel('moisture', 60, ideal, acceptable).status).toBe('in');
    expect(evaluateChannel('moisture', 75, ideal, acceptable).status).toBe('in');
  });

  it('a value just past an edge flips status', () => {
    expect(evaluateChannel('moisture', 59.9, ideal, acceptable).status).toBe('below');
    expect(evaluateChannel('moisture', 75.1, ideal, acceptable).status).toBe('above');
  });

  it('reports unknown for missing / NaN readings', () => {
    expect(evaluateChannel('moisture', undefined, ideal, acceptable).status).toBe('unknown');
    expect(evaluateChannel('moisture', NaN, ideal, acceptable).status).toBe('unknown');
    const r = evaluateChannel('moisture', undefined, ideal, acceptable);
    expect(r.value).toBeNull();
    expect(r.deviation).toBe(0);
  });

  it('unions ideal into acceptable so acceptable always contains ideal', () => {
    // pathological: acceptable narrower than ideal → should be widened by union
    const r = evaluateChannel('moisture', 70, [60, 75], [62, 70]);
    expect(r.acceptableRange[0]).toBeLessThanOrEqual(60);
    expect(r.acceptableRange[1]).toBeGreaterThanOrEqual(75);
  });
});

describe('evaluateChannels', () => {
  const band: CropBand = {
    moisture: [60, 75], ph: [6, 6.8], ec: [2, 3.5], n: [100, 150],
    p: [40, 60], k: [150, 250], soilTemp: [18, 26], airTemp: [20, 28],
  };

  it('returns all eight channels in canonical order', () => {
    const out = evaluateChannels(band, { moisture: 70 });
    expect(out.map((c) => c.channel)).toEqual([...ENGINE_CHANNELS]);
  });

  it('missing readings come back as unknown, present ones classified', () => {
    const out = evaluateChannels(band, { moisture: 50, ph: 6.4 });
    const byCh = Object.fromEntries(out.map((c) => [c.channel, c]));
    expect(byCh.moisture.status).toBe('below');
    expect(byCh.ph.status).toBe('in');
    expect(byCh.n.status).toBe('unknown');
    expect(byCh.airTemp.status).toBe('unknown');
  });

  it('evaluateChannelsWithAcceptable uses the wider acceptable band for range', () => {
    const accept: CropBand = {
      moisture: [55, 80], ph: [5.5, 7.3], ec: [1.7, 3.8], n: [87, 162],
      p: [35, 65], k: [130, 270], soilTemp: [16, 28], airTemp: [18, 30],
    };
    const out = evaluateChannelsWithAcceptable(band, accept, { moisture: 70 });
    const m = out.find((c) => c.channel === 'moisture')!;
    expect(m.acceptableRange).toEqual([55, 80]);
    expect(m.idealRange).toEqual([60, 75]);
  });
});
