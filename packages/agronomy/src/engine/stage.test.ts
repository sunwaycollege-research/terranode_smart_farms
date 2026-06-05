import { describe, it, expect } from 'vitest';
import { currentStage } from './stage';
import { tomato, spinach } from '../crops/index';

const DAY = 86_400_000;
function daysAgo(n: number): Date {
  return new Date(Date.now() - n * DAY);
}

describe('currentStage', () => {
  it('clamps to the first stage at planting day', () => {
    const r = currentStage(tomato, daysAgo(0));
    expect(r.stage).toBe('germination');
    expect(r.daysSincePlanting).toBe(0);
    expect(r.daysToHarvest).toBe(tomato.daysToHarvest);
    expect(r.def.ordinal).toBe(0);
  });

  it('returns the highest-ordinal stage whose startDay <= elapsed', () => {
    expect(currentStage(tomato, daysAgo(10)).stage).toBe('germination'); // <21
    expect(currentStage(tomato, daysAgo(21)).stage).toBe('vegetative'); // boundary
    expect(currentStage(tomato, daysAgo(30)).stage).toBe('vegetative');
    expect(currentStage(tomato, daysAgo(45)).stage).toBe('flowering'); // boundary
    expect(currentStage(tomato, daysAgo(65)).stage).toBe('fruiting'); // boundary
    expect(currentStage(tomato, daysAgo(95)).stage).toBe('harvest'); // boundary
    expect(currentStage(tomato, daysAgo(200)).stage).toBe('harvest'); // past end stays harvest
  });

  it('exact boundary day picks the new stage (inclusive startDay)', () => {
    const r = currentStage(tomato, daysAgo(45));
    expect(r.stage).toBe('flowering');
    expect(r.def.startDay).toBe(45);
  });

  it('one day before a boundary keeps the previous stage', () => {
    expect(currentStage(tomato, daysAgo(44)).stage).toBe('vegetative');
    expect(currentStage(tomato, daysAgo(64)).stage).toBe('flowering');
  });

  it('daysToHarvest counts down and floors at 0', () => {
    expect(currentStage(tomato, daysAgo(10)).daysToHarvest).toBe(100);
    expect(currentStage(tomato, daysAgo(110)).daysToHarvest).toBe(0);
    expect(currentStage(tomato, daysAgo(150)).daysToHarvest).toBe(0);
  });

  it('accepts ISO string and epoch-ms planting dates', () => {
    const iso = new Date(Date.now() - 30 * DAY).toISOString();
    expect(currentStage(tomato, iso).stage).toBe('vegetative');
    const ms = Date.now() - 30 * DAY;
    expect(currentStage(tomato, ms).stage).toBe('vegetative');
  });

  it('honours an explicit `now` argument (deterministic)', () => {
    const planted = new Date('2026-01-01T00:00:00Z');
    const now = new Date('2026-02-15T00:00:00Z'); // 45 days later
    const r = currentStage(tomato, planted, now);
    expect(r.daysSincePlanting).toBe(45);
    expect(r.stage).toBe('flowering');
  });

  it('works for leafy crops that skip flowering/fruiting', () => {
    expect(currentStage(spinach, daysAgo(0)).stage).toBe('germination');
    expect(currentStage(spinach, daysAgo(12)).stage).toBe('vegetative');
    expect(currentStage(spinach, daysAgo(40)).stage).toBe('harvest');
  });
});
