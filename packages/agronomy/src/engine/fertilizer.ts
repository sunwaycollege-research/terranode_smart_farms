// Crop-stage fertilizer guidance (research-backed, bilingual).
//
// Turns the verified agronomy research (see docs/RESEARCH.md) into farmer-facing,
// stage-aware fertilizer advice. This is ADDITIVE and standalone — it does not
// touch the deterministic per-channel `recommendations()` engine. Doses are
// regional starting references (TNAU Tamil Nadu / JICA + NAST Nepal), NOT a
// prescription: always pair with the soil probe trend + local extension advice.
//
// Sources: TNAU "Fertilizer Schedule for Vegetables"; JICA Nepal Vegetable
// Farming Manual (2016); NAST "Comprehensive Insights in Vegetables of Nepal"
// (2021). The 7-in-1 probe's N/P/K are EC-derived estimates ("use with
// caution"), so this schedule — not raw probe NPK — should anchor dosing.

import type { GrowthStage } from '@teranode/types';

export interface FertilizerAdvice {
  cropId: string;
  stage: GrowthStage;
  /** Short headline, e.g. "Basal dose at planting". */
  titleEn: string;
  titleNe: string;
  /** What to apply now (concrete amounts, per ropani-scale guidance kept simple). */
  doseEn: string;
  doseNe: string;
  /** Organic / low-cost alternative a smallholder can use. */
  organicEn: string;
  organicNe: string;
  /** Citation tag shown small in the UI. */
  source: string;
}

type StageMap = Partial<Record<GrowthStage, Omit<FertilizerAdvice, 'cropId' | 'stage'>>>;

// Per-crop, per-stage advice. Where a stage is absent we fall back (see plan()).
const PLANS: Record<string, StageMap> = {
  tomato: {
    germination: {
      titleEn: 'Basal dose at transplanting',
      titleNe: 'रोप्दा आधार मल',
      doseEn: 'Mix in well-rotted FYM/compost + a balanced NPK (≈75:100:50 kg/ha) before transplanting. Add a little borax + zinc.',
      doseNe: 'रोप्नुअघि कुहिएको गोबर मल + सन्तुलित NPK (≈७५:१००:५०) मिसाउनुहोस्। थोरै बोरेक्स र जिंक हाल्नुहोस्।',
      organicEn: 'No chemicals? Use 2–3 kg compost per plant pit + a handful of bone meal (P) and wood ash (K).',
      organicNe: 'रसायन छैन? प्रति खाडल २–३ केजी कम्पोस्ट + मुठ्ठीभर हड्डी धूलो (P) र खरानी (K)।',
      source: 'TNAU',
    },
    vegetative: {
      titleEn: 'Top-dress nitrogen (~30 days)',
      titleNe: 'नाइट्रोजन थप्ने (~३० दिन)',
      doseEn: 'At earthing-up (~30 days) side-dress extra nitrogen (urea) to drive leafy growth.',
      doseNe: 'माटो चढाउँदा (~३० दिन) छेउमा अतिरिक्त नाइट्रोजन (युरिया) हाल्नुहोस्।',
      organicEn: 'Organic: top-dress with vermicompost or diluted cow-urine + jholmal.',
      organicNe: 'जैविक: भर्मिकम्पोस्ट वा पातलो गहुँत + झोलमल हाल्नुहोस्।',
      source: 'TNAU',
    },
    fruiting: {
      titleEn: 'Potassium for fruit set',
      titleNe: 'फल लाग्दा पोटास',
      doseEn: 'During flowering/fruiting favour potassium (MOP) over nitrogen for better fruit set and quality.',
      doseNe: 'फूल/फल लाग्दा नाइट्रोजनभन्दा पोटास (MOP) बढी दिनुहोस् — फल राम्रो लाग्छ।',
      organicEn: 'Organic: wood ash or banana-peel compost adds potassium.',
      organicNe: 'जैविक: खरानी वा केराको बोक्राको कम्पोस्टले पोटास दिन्छ।',
      source: 'TNAU',
    },
  },
  potato: {
    germination: {
      titleEn: 'Basal dose at planting',
      titleNe: 'रोप्दा आधार मल',
      doseEn: 'Apply half the nitrogen + all phosphorus & potassium + 15 t/ha FYM at planting (rich P needs).',
      doseNe: 'रोप्दा आधा नाइट्रोजन + सबै फस्फोरस र पोटास + गोबर मल हाल्नुहोस् (फस्फोरस धेरै चाहिन्छ)।',
      organicEn: 'Organic: plenty of compost + bone meal in the furrow before covering seed tubers.',
      organicNe: 'जैविक: बीउ छोप्नुअघि कुलेसोमा प्रशस्त कम्पोस्ट + हड्डी धूलो।',
      source: 'TNAU',
    },
    vegetative: {
      titleEn: 'Top-dress at earthing-up (~30 days)',
      titleNe: 'माटो चढाउँदा थप्ने (~३० दिन)',
      doseEn: 'Side-dress the remaining half of nitrogen at earthing-up (~30 days).',
      doseNe: 'माटो चढाउँदा (~३० दिन) बाँकी आधा नाइट्रोजन छेउमा हाल्नुहोस्।',
      organicEn: 'Organic: top-dress with vermicompost during earthing-up.',
      organicNe: 'जैविक: माटो चढाउँदा भर्मिकम्पोस्ट हाल्नुहोस्।',
      source: 'TNAU',
    },
  },
  onion: {
    germination: {
      titleEn: 'Basal at transplanting',
      titleNe: 'रोप्दा आधार मल',
      doseEn: 'Work in FYM + phosphorus & potassium. Onion peaks near ~120 kg N/ha total — apply part now.',
      doseNe: 'गोबर मल + फस्फोरस र पोटास मिसाउनुहोस्। प्याजलाई कुल ~१२० केजी/हे नाइट्रोजन चाहिन्छ — केही अहिले।',
      organicEn: 'Organic: compost + wood ash worked into the bed.',
      organicNe: 'जैविक: क्यारीमा कम्पोस्ट + खरानी मिसाउनुहोस्।',
      source: 'NAST Nepal',
    },
    vegetative: {
      titleEn: 'Split nitrogen for bulbing',
      titleNe: 'गाँठा लाग्न नाइट्रोजन',
      doseEn: 'Top-dress nitrogen in 2 splits during leaf growth; stop N once bulbs start sizing.',
      doseNe: 'पात बढ्दा नाइट्रोजन २ पटक हाल्नुहोस्; गाँठा लाग्न थालेपछि रोक्नुहोस्।',
      organicEn: 'Organic: diluted jholmal every 2–3 weeks during leaf growth.',
      organicNe: 'जैविक: पात बढ्दा हरेक २–३ हप्तामा पातलो झोलमल।',
      source: 'NAST Nepal',
    },
  },
  garlic: {
    germination: {
      titleEn: 'Basal dose at planting',
      titleNe: 'रोप्दा आधार मल',
      doseEn: 'Heavy FYM (well-rotted) + balanced NPK (~40:75:75) + neem cake basal.',
      doseNe: 'प्रशस्त कुहिएको गोबर मल + सन्तुलित NPK (~४०:७५:७५) + निम पिना।',
      organicEn: 'Organic: rich compost + bone meal + wood ash; garlic loves organic matter.',
      organicNe: 'जैविक: मलिलो कम्पोस्ट + हड्डी धूलो + खरानी।',
      source: 'TNAU',
    },
    vegetative: {
      titleEn: 'Nitrogen top-dress (~45 days)',
      titleNe: 'नाइट्रोजन थप्ने (~४५ दिन)',
      doseEn: 'Side-dress nitrogen around 45 days for strong leaf growth before bulbing.',
      doseNe: 'गाँठा लाग्नुअघि ~४५ दिनमा नाइट्रोजन छेउमा हाल्नुहोस्।',
      organicEn: 'Organic: vermicompost or jholmal top-dress.',
      organicNe: 'जैविक: भर्मिकम्पोस्ट वा झोलमल हाल्नुहोस्।',
      source: 'TNAU',
    },
  },
  chili: {
    germination: {
      titleEn: 'Basal at transplanting',
      titleNe: 'रोप्दा आधार मल',
      doseEn: 'FYM + basal NPK (~30:60:30). Phosphorus-rich start helps rooting.',
      doseNe: 'गोबर मल + आधार NPK (~३०:६०:३०)। फस्फोरसले जरा बलियो बनाउँछ।',
      organicEn: 'Organic: compost + bone meal in each pit.',
      organicNe: 'जैविक: प्रत्येक खाडलमा कम्पोस्ट + हड्डी धूलो।',
      source: 'TNAU',
    },
    flowering: {
      titleEn: 'Nitrogen splits (30/60/90 days)',
      titleNe: 'नाइट्रोजन (३०/६०/९० दिन)',
      doseEn: 'Top-dress nitrogen in three splits at ~30, 60 and 90 days for continuous picking.',
      doseNe: 'निरन्तर टिप्नका लागि ~३०, ६०, ९० दिनमा तीन पटक नाइट्रोजन हाल्नुहोस्।',
      organicEn: 'Organic: jholmal every 3 weeks through the picking season.',
      organicNe: 'जैविक: टिप्ने सिजनभरि हरेक ३ हप्तामा झोलमल।',
      source: 'TNAU',
    },
  },
  cauliflower: {
    germination: {
      titleEn: 'Basal + boron (critical!)',
      titleNe: 'आधार मल + बोरोन (अत्यावश्यक!)',
      doseEn: 'FYM + NPK basal AND 15–20 kg/ha borax — boron deficiency causes brown, hollow curds.',
      doseNe: 'गोबर मल + NPK + १५–२० केजी/हे बोरेक्स — बोरोन नभए दली खैरो/खाली हुन्छ।',
      organicEn: 'Organic: vermicompost; still add borax — organic matter alone rarely fixes boron.',
      organicNe: 'जैविक: भर्मिकम्पोस्ट; तर बोरेक्स अवश्य हाल्नुहोस्।',
      source: 'NAST Nepal',
    },
    vegetative: {
      titleEn: 'Nitrogen for curd growth',
      titleNe: 'दली बढाउन नाइट्रोजन',
      doseEn: 'Top-dress nitrogen during head/curd formation; keep soil evenly moist.',
      doseNe: 'दली बन्दा नाइट्रोजन हाल्नुहोस्; माटो समान रूपमा चिस्यान राख्नुहोस्।',
      organicEn: 'Organic: jholmal + steady compost mulch.',
      organicNe: 'जैविक: झोलमल + कम्पोस्ट मल्च।',
      source: 'NAST Nepal',
    },
  },
};

// A generic, crop-agnostic fallback so every crop+stage says something useful.
const GENERIC: StageMap = {
  germination: {
    titleEn: 'Feed the soil before planting',
    titleNe: 'रोप्नुअघि माटो मलिलो बनाउनुहोस्',
    doseEn: 'Mix in well-rotted compost/FYM and a balanced NPK at planting.',
    doseNe: 'रोप्दा कुहिएको कम्पोस्ट/गोबर मल र सन्तुलित NPK मिसाउनुहोस्।',
    organicEn: 'Compost + bone meal (P) + wood ash (K) is a solid organic base.',
    organicNe: 'कम्पोस्ट + हड्डी धूलो (P) + खरानी (K) राम्रो जैविक आधार हो।',
    source: 'General',
  },
  vegetative: {
    titleEn: 'Nitrogen for leafy growth',
    titleNe: 'पात बढाउन नाइट्रोजन',
    doseEn: 'Side-dress nitrogen during active leaf growth; watch the EC trend so you do not over-feed.',
    doseNe: 'पात बढ्दा नाइट्रोजन हाल्नुहोस्; धेरै नहोस् भनेर EC हेर्नुहोस्।',
    organicEn: 'Organic: vermicompost or diluted jholmal every 2–3 weeks.',
    organicNe: 'जैविक: हरेक २–३ हप्तामा भर्मिकम्पोस्ट वा झोलमल।',
    source: 'General',
  },
  flowering: {
    titleEn: 'Ease nitrogen, add potassium',
    titleNe: 'नाइट्रोजन घटाउनुहोस्, पोटास थप्नुहोस्',
    doseEn: 'At flowering reduce nitrogen and favour potassium for flowers/fruit.',
    doseNe: 'फूल लाग्दा नाइट्रोजन घटाएर पोटास बढाउनुहोस्।',
    organicEn: 'Organic: wood ash / banana-peel compost for potassium.',
    organicNe: 'जैविक: पोटासका लागि खरानी / केराको बोक्रा कम्पोस्ट।',
    source: 'General',
  },
  fruiting: {
    titleEn: 'Potassium for fruit quality',
    titleNe: 'फलको गुणका लागि पोटास',
    doseEn: 'Keep potassium up and nitrogen modest during fruiting; keep moisture steady.',
    doseNe: 'फल लाग्दा पोटास राख्नुहोस्, नाइट्रोजन थोरै; चिस्यान स्थिर राख्नुहोस्।',
    organicEn: 'Organic: wood ash + steady compost; avoid heavy fresh nitrogen now.',
    organicNe: 'जैविक: खरानी + कम्पोस्ट; अहिले ताजा नाइट्रोजन धेरै नहाल्नुहोस्।',
    source: 'General',
  },
  harvest: {
    titleEn: 'Stop feeding before harvest',
    titleNe: 'कटाइअघि मल रोक्नुहोस्',
    doseEn: 'Stop fertilising as harvest nears so produce is clean and stores well.',
    doseNe: 'कटाइ नजिक आउँदा मल रोक्नुहोस् — उब्जनी सफा र राम्रो रहन्छ।',
    organicEn: 'Just keep moisture even; no fresh feeding needed.',
    organicNe: 'चिस्यान मात्र मिलाउनुहोस्; नयाँ मल चाहिँदैन।',
    source: 'General',
  },
};

/** Nearest earlier stage with advice, for graceful fallback within a crop plan. */
const STAGE_ORDER: GrowthStage[] = ['germination', 'vegetative', 'flowering', 'fruiting', 'harvest'];

/**
 * Stage-aware fertilizer advice for a crop. Returns the crop-specific entry when
 * present, else the nearest earlier crop-specific stage, else the generic plan.
 * Always returns something useful (never null) so the Coach/Plan UI is never empty.
 */
export function fertilizerPlan(cropId: string, stage: GrowthStage): FertilizerAdvice {
  const crop = PLANS[cropId];
  const pick = (map: StageMap): Omit<FertilizerAdvice, 'cropId' | 'stage'> | null => {
    if (map[stage]) return map[stage]!;
    // fall back to the nearest earlier stage that has advice
    const idx = STAGE_ORDER.indexOf(stage);
    for (let i = idx - 1; i >= 0; i--) {
      const s = STAGE_ORDER[i];
      if (map[s]) return map[s]!;
    }
    return null;
  };
  const body = (crop && pick(crop)) ?? pick(GENERIC) ?? GENERIC.vegetative!;
  return { cropId, stage, ...body };
}

/** The full stage-by-stage fertilizer schedule for a crop (for crop-info screens). */
export function fertilizerSchedule(cropId: string): FertilizerAdvice[] {
  return STAGE_ORDER.map((stage) => fertilizerPlan(cropId, stage));
}
