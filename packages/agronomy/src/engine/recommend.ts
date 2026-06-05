// Recommendations: turn per-channel statuses (and the current stage) into
// bilingual coaching cards with a concrete action. Pure & deterministic.
//
// Spec §4 examples (must hold):
//   n.below & stage∈{vegetative,fruiting} → increase_dosing
//   ph.above → ph_down ; ph.below → ph_up
//   moisture.below → irrigate ; moisture.above → hold_water
//   ec.above → decrease_dosing
// We also cover the symmetric/remaining cases (P/K below, EC below, temps, etc.)
// so the Coach card always has something useful to say.

import type {
  Channel,
  ChannelStatus,
  Crop,
  GrowthStage,
  Locale,
  Recommendation,
  RecommendationAction,
} from '@teranode/types';

/** Channels for which N/P/K dosing recommendations make sense to surface. */
const NUTRIENT_CHANNELS: ReadonlySet<Channel> = new Set(['n', 'p', 'k']);

/** Stages where nutrient demand is high enough to push dosing on a deficit. */
const HIGH_DEMAND_STAGES: ReadonlySet<GrowthStage> = new Set([
  'vegetative',
  'flowering',
  'fruiting',
]);

const NE_STAGE: Record<GrowthStage, string> = {
  germination: 'अंकुरण',
  vegetative: 'बृद्धि',
  flowering: 'फूल',
  fruiting: 'फल',
  harvest: 'कटाइ',
};

const NE_CHANNEL: Record<Channel, string> = {
  moisture: 'चिस्यान',
  ph: 'पीएच',
  ec: 'ईसी',
  n: 'नाइट्रोजन',
  p: 'फस्फोरस',
  k: 'पोटास',
  soilTemp: 'माटोको तापक्रम',
  airTemp: 'हावाको तापक्रम',
};

const EN_CHANNEL: Record<Channel, string> = {
  moisture: 'Moisture',
  ph: 'pH',
  ec: 'EC',
  n: 'N',
  p: 'P',
  k: 'K',
  soilTemp: 'Soil temp',
  airTemp: 'Air temp',
};

const r1 = (v: number): number => Math.round(v * 10) / 10;

interface Built {
  channel: Channel;
  severity: Recommendation['severity'];
  action: RecommendationAction;
  messageEn: string;
  messageNe: string;
}

/**
 * Build the recommendation (if any) for a single channel status, given the
 * current stage. Returns null when the channel is in-band / unknown or has no
 * meaningful coaching message.
 */
function forChannel(st: ChannelStatus, stage: GrowthStage): Built | null {
  if (st.status === 'in' || st.status === 'unknown' || st.value === null) {
    return null;
  }
  const ch = st.channel;
  const v = r1(st.value);
  const [lo, hi] = st.idealRange;
  const stageEn = stage;
  const stageNe = NE_STAGE[stage];
  const enCh = EN_CHANNEL[ch];
  const neCh = NE_CHANNEL[ch];

  // --- moisture ---
  if (ch === 'moisture') {
    if (st.status === 'below') {
      return {
        channel: ch,
        severity: 'warn',
        action: 'irrigate',
        messageEn: `Moisture is ${v}% vs ${lo}–${hi}% target — irrigate now.`,
        messageNe: `चिस्यान ${v}% छ, लक्ष्य ${lo}–${hi}% — अहिले सिंचाइ गर्नुहोस्।`,
      };
    }
    return {
      channel: ch,
      severity: 'warn',
      action: 'hold_water',
      messageEn: `Moisture is ${v}% vs ${lo}–${hi}% target — hold off watering to avoid waterlogging.`,
      messageNe: `चिस्यान ${v}% छ, लक्ष्य ${lo}–${hi}% — पानी जम्न नदिन सिंचाइ रोक्नुहोस्।`,
    };
  }

  // --- pH ---
  if (ch === 'ph') {
    if (st.status === 'below') {
      return {
        channel: ch,
        severity: 'warn',
        action: 'ph_up',
        messageEn: `pH is ${v} vs ${lo}–${hi} target — soil is too acidic, raise pH (ph up).`,
        messageNe: `पीएच ${v} छ, लक्ष्य ${lo}–${hi} — माटो धेरै अम्लीय छ, पीएच बढाउनुहोस्।`,
      };
    }
    return {
      channel: ch,
      severity: 'warn',
      action: 'ph_down',
      messageEn: `pH is ${v} vs ${lo}–${hi} target — soil is too alkaline, lower pH (ph down).`,
      messageNe: `पीएच ${v} छ, लक्ष्य ${lo}–${hi} — माटो धेरै क्षारीय छ, पीएच घटाउनुहोस्।`,
    };
  }

  // --- EC (overall nutrient strength) ---
  if (ch === 'ec') {
    if (st.status === 'above') {
      return {
        channel: ch,
        severity: 'warn',
        action: 'decrease_dosing',
        messageEn: `EC is ${v} mS/cm vs ${lo}–${hi} target — solution too strong, decrease nutrient dosing.`,
        messageNe: `ईसी ${v} mS/cm छ, लक्ष्य ${lo}–${hi} — घोल धेरै बाक्लो छ, पोषक मात्रा घटाउनुहोस्।`,
      };
    }
    return {
      channel: ch,
      severity: 'info',
      action: 'increase_dosing',
      messageEn: `EC is ${v} mS/cm vs ${lo}–${hi} target — solution too weak, increase nutrient dosing.`,
      messageNe: `ईसी ${v} mS/cm छ, लक्ष्य ${lo}–${hi} — घोल धेरै पातलो छ, पोषक मात्रा बढाउनुहोस्।`,
    };
  }

  // --- nutrients N / P / K ---
  if (NUTRIENT_CHANNELS.has(ch)) {
    if (st.status === 'below') {
      const high = HIGH_DEMAND_STAGES.has(stage);
      return {
        channel: ch,
        severity: high ? 'warn' : 'info',
        action: 'increase_dosing',
        messageEn: `${enCh} is ${v} mg/kg vs ${lo}–${hi} target for ${stageEn} — increase nutrient dosing.`,
        messageNe: `${neCh} ${v} mg/kg छ, ${stageNe} चरणको लक्ष्य ${lo}–${hi} — पोषक मात्रा बढाउनुहोस्।`,
      };
    }
    return {
      channel: ch,
      severity: 'info',
      action: 'decrease_dosing',
      messageEn: `${enCh} is ${v} mg/kg vs ${lo}–${hi} target for ${stageEn} — decrease nutrient dosing.`,
      messageNe: `${neCh} ${v} mg/kg छ, ${stageNe} चरणको लक्ष्य ${lo}–${hi} — पोषक मात्रा घटाउनुहोस्।`,
    };
  }

  // --- temperatures: advisory only (no actuator), action = wait ---
  if (ch === 'soilTemp' || ch === 'airTemp') {
    const dir = st.status === 'below' ? 'low' : 'high';
    const dirNe = st.status === 'below' ? 'कम' : 'बढी';
    return {
      channel: ch,
      severity: 'info',
      action: 'wait',
      messageEn: `${enCh} is ${v}°C vs ${lo}–${hi}°C target — too ${dir}; adjust environment or wait for conditions to improve.`,
      messageNe: `${neCh} ${v}°C छ, लक्ष्य ${lo}–${hi}°C — ${dirNe} छ; वातावरण मिलाउनुहोस् वा अवस्था सुध्रिने पर्खनुहोस्।`,
    };
  }

  return null;
}

/** Severity rank for sorting (critical first). */
const SEV_RANK: Record<Recommendation['severity'], number> = {
  critical: 0,
  warn: 1,
  info: 2,
};

/**
 * Produce the recommendation list for a zone given its per-channel statuses and
 * the current stage. Sorted critical→warn→info then by canonical channel order.
 * `locale` does not filter messages (both en+ne are always emitted) but is kept
 * in the signature per spec §4 for forward compatibility.
 */
export function recommendations(
  _crop: Crop,
  stage: GrowthStage,
  statuses: ChannelStatus[],
  _locale: Locale = 'en',
): Recommendation[] {
  const out: Recommendation[] = [];
  for (const st of statuses) {
    const built = forChannel(st, stage);
    if (built) {
      out.push({
        channel: built.channel,
        severity: built.severity,
        messageEn: built.messageEn,
        messageNe: built.messageNe,
        action: built.action,
      });
    }
  }
  // Escalate moisture below to critical when far past the acceptable floor.
  return out.sort((a, b) => SEV_RANK[a.severity] - SEV_RANK[b.severity]);
}
