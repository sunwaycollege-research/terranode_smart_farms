// 🥬 Spinach — leafy, 45 days. Fully specified in spec §3. Leafy: no flowering/fruiting.
import { buildCrop } from './builder';

export const spinach = buildCrop({
  id: 'spinach',
  nameEn: 'Spinach',
  nameNe: 'पालुङ्गो',
  emoji: '🥬',
  category: 'leafy',
  daysToHarvest: 45,
  wateringNotesEn:
    'Keep soil consistently moist for fast, tender leaf growth; light frequent watering suits shallow roots.',
  wateringNotesNe:
    'छिटो र नरम पात बढ्न माटो निरन्तर ओसिलो राख्नुहोस्; छिपछिपे जरा भएकाले हल्का तर बारम्बार सिंचाइ उपयुक्त हुन्छ।',
  ideal: {
    moisture: [65, 80],
    ph: [6.0, 7.0],
    ec: [1.2, 2.0],
    n: [120, 180],
    p: [40, 55],
    k: [140, 200],
    soilTemp: [10, 22],
    airTemp: [12, 24],
  },
  stages: [
    { stage: 'germination', startDay: 0, ideal: { moisture: [70, 85], ec: [0.8, 1.2] } },
    { stage: 'vegetative', startDay: 12, ideal: { n: [150, 180], ec: [1.4, 1.8] } },
    { stage: 'harvest', startDay: 35, ideal: { n: [120, 150], moisture: [65, 78] } },
  ],
});
