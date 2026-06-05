// 🍅 Tomato — fruiting, 110 days. Fully specified in spec §3.
import { buildCrop } from './builder';

export const tomato = buildCrop({
  id: 'tomato',
  nameEn: 'Tomato',
  nameNe: 'गोलभेडा',
  emoji: '🍅',
  category: 'fruiting',
  daysToHarvest: 110,
  wateringNotesEn:
    'Keep soil evenly moist; avoid waterlogging. Deep, less-frequent watering encourages strong roots and reduces blossom-end rot.',
  wateringNotesNe:
    'माटो समान रूपमा ओसिलो राख्नुहोस्; पानी जम्न नदिनुहोस्। गहिरो तर कम पटक सिंचाइले बलियो जरा बनाउँछ।',
  ideal: {
    moisture: [60, 75],
    ph: [6.0, 6.8],
    ec: [2.0, 3.5],
    n: [100, 150],
    p: [40, 60],
    k: [150, 250],
    soilTemp: [18, 26],
    airTemp: [20, 28],
  },
  stages: [
    { stage: 'germination', startDay: 0, ideal: { moisture: [65, 80], ec: [1.0, 1.5], n: [60, 90] } },
    { stage: 'vegetative', startDay: 21, ideal: { moisture: [60, 75], ec: [1.8, 2.5], n: [120, 150], k: [120, 180] } },
    { stage: 'flowering', startDay: 45, ideal: { moisture: [60, 70], ec: [2.2, 3.0], p: [50, 70], k: [180, 220] } },
    { stage: 'fruiting', startDay: 65, ideal: { moisture: [65, 75], ec: [2.5, 3.5], n: [100, 130], k: [200, 280] } },
    { stage: 'harvest', startDay: 95, ideal: { moisture: [55, 70], ec: [2.0, 3.0] } },
  ],
});
