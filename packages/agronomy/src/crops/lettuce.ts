// 🥗 Lettuce — leafy, 50 days. Leafy: germination → vegetative → harvest (no flowering/fruiting).
import { buildCrop } from './builder';

export const lettuce = buildCrop({
  id: 'lettuce',
  nameEn: 'Lettuce',
  nameNe: 'सलाद',
  emoji: '🥗',
  category: 'leafy',
  daysToHarvest: 50,
  wateringNotesEn:
    'Keep soil consistently moist and cool; shallow roots dry out fast. Light, frequent watering prevents bitterness and bolting.',
  wateringNotesNe:
    'माटो निरन्तर ओसिलो र चिसो राख्नुहोस्; छिपछिपे जरा छिटो सुक्छ। हल्का र बारम्बार सिंचाइले तीतोपन र फूल फुल्न रोक्छ।',
  ideal: {
    moisture: [65, 80],
    ph: [6.0, 7.0],
    ec: [1.2, 1.8],
    n: [100, 150],
    p: [35, 50],
    k: [130, 180],
    soilTemp: [10, 20],
    airTemp: [12, 22],
  },
  stages: [
    { stage: 'germination', startDay: 0, ideal: { moisture: [70, 85], ec: [0.8, 1.2], n: [60, 90] } },
    { stage: 'vegetative', startDay: 14, ideal: { n: [120, 150], ec: [1.4, 1.8] } },
    { stage: 'harvest', startDay: 40, ideal: { n: [100, 130], moisture: [65, 78] } },
  ],
});
