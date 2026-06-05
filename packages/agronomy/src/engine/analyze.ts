// analyzeZone — the end-to-end orchestrator the API and the mobile mock both
// call. Given a crop, a planting date, and a reading set, it derives the current
// stage, the per-channel banding + health, the coaching recommendations, and the
// controller rule, all from the SAME stage band so the numbers are consistent.

import type {
  ChannelReadings,
  Crop,
  Locale,
  ZoneAnalysis,
} from '@teranode/types';
import { currentStage } from './stage';
import { zoneHealth } from './health';
import { recommendations } from './recommend';
import { deriveRule } from './rules';

export interface AnalyzeZoneInput {
  crop: Crop;
  plantingDate: Date | string | number;
  readings: ChannelReadings;
  now?: Date | string | number;
  locale?: Locale;
}

/**
 * Full zone analysis (spec §4). Health and channel banding use the current
 * stage's ideal + acceptable bands; recommendations use the same channel
 * statuses; the rule is derived from the same stage. Deterministic given inputs.
 */
export function analyzeZone(input: AnalyzeZoneInput): ZoneAnalysis {
  const { crop, plantingDate, readings, now, locale = 'en' } = input;

  const cs = currentStage(crop, plantingDate, now);
  const ideal = cs.def.ideal;
  const acceptable = cs.def.acceptable;

  const health = zoneHealth(ideal, acceptable, readings);
  const channels = health.perChannel;
  const recs = recommendations(crop, cs.stage, channels, locale);
  const rule = deriveRule(crop, cs.def);

  return {
    stage: cs.stage,
    daysSincePlanting: cs.daysSincePlanting,
    health,
    channels,
    recommendations: recs,
    rule,
  };
}
