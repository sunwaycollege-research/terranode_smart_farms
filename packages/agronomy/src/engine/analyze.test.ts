import { describe, it, expect } from 'vitest';
import { analyzeZone } from './analyze';
import { currentStage } from './stage';
import { deriveRule } from './rules';
import { tomato } from '../crops/index';

const DAY = 86_400_000;
// Deterministic clock: plant on a fixed date, analyze 65 days later → fruiting.
const PLANTED = new Date('2026-01-01T00:00:00Z');
const NOW_65 = new Date(PLANTED.getTime() + 65 * DAY);

describe('analyzeZone — end-to-end (tomato)', () => {
  it('derives the fruiting stage at 65 days post-planting', () => {
    const a = analyzeZone({
      crop: tomato,
      plantingDate: PLANTED,
      now: NOW_65,
      readings: {},
    });
    expect(a.stage).toBe('fruiting');
    expect(a.daysSincePlanting).toBe(65);
  });

  it('returns full health=100 with no recommendations when all readings are ideal', () => {
    const fruiting = tomato.stages.find((s) => s.stage === 'fruiting')!.ideal;
    const a = analyzeZone({
      crop: tomato,
      plantingDate: PLANTED,
      now: NOW_65,
      readings: {
        moisture: 70, ph: 6.4, ec: 3.0,
        n: 115, p: 50, k: 240, soilTemp: 22, airTemp: 24,
      },
    });
    expect(a.health.score).toBe(100);
    expect(a.recommendations).toEqual([]);
    // channel statuses cover all 8 engine channels, all in-band
    expect(a.channels).toHaveLength(8);
    expect(a.channels.every((c) => c.status === 'in')).toBe(true);
    // rule derived from the SAME fruiting stage band
    expect(a.rule.moistureLow).toBe(fruiting.moisture[0]);
    expect(a.rule.moistureHigh).toBe(fruiting.moisture[1]);
  });

  it('flags stressed channels with matching recommendations and a lower score', () => {
    const a = analyzeZone({
      crop: tomato,
      plantingDate: PLANTED,
      now: NOW_65,
      readings: { moisture: 40, ph: 7.6, n: 50 },
    });
    expect(a.health.score).toBeGreaterThanOrEqual(0);
    expect(a.health.score).toBeLessThan(100);
    const actions = a.recommendations.map((r) => `${r.channel}:${r.action}`);
    expect(actions).toContain('moisture:irrigate');
    expect(actions).toContain('ph:ph_down');
    expect(actions).toContain('n:increase_dosing');
    // every rec carries bilingual messages
    for (const r of a.recommendations) {
      expect(r.messageEn.length).toBeGreaterThan(0);
      expect(r.messageNe.length).toBeGreaterThan(0);
    }
  });

  it('is internally consistent: stage/rule match currentStage/deriveRule', () => {
    const a = analyzeZone({
      crop: tomato,
      plantingDate: PLANTED,
      now: NOW_65,
      readings: { moisture: 70 },
    });
    const cs = currentStage(tomato, PLANTED, NOW_65);
    expect(a.stage).toBe(cs.stage);
    expect(a.rule).toEqual(deriveRule(tomato, cs.def));
  });

  it('is deterministic — same inputs yield identical output', () => {
    const input = {
      crop: tomato,
      plantingDate: PLANTED,
      now: NOW_65,
      readings: { moisture: 55, ph: 6.4, n: 90 },
    };
    expect(analyzeZone(input)).toEqual(analyzeZone(input));
  });

  it('accepts an ISO planting string and uses the germination stage at day 0', () => {
    const a = analyzeZone({
      crop: tomato,
      plantingDate: PLANTED.toISOString(),
      now: PLANTED.toISOString(),
      readings: { moisture: 72 }, // germination ideal moisture 65–80 → in-band
    });
    expect(a.stage).toBe('germination');
    expect(a.daysSincePlanting).toBe(0);
    expect(a.health.score).toBe(100);
  });
});
