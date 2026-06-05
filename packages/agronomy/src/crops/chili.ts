// 🌶️ Chili — fruiting, 95 days. Whole-crop ideal from spec §3 table; plausible stages.
import { buildCrop } from './builder';

export const chili = buildCrop({
  id: 'chili',
  nameEn: 'Chili',
  nameNe: 'खुर्सानी',
  emoji: '🌶️',
  category: 'fruiting',
  daysToHarvest: 95,
  wateringNotesEn:
    'Moderate, steady moisture; slight drying between waterings concentrates pungency. Avoid waterlogging during flowering.',
  wateringNotesNe:
    'मध्यम र स्थिर ओसिलोपन राख्नुहोस्; बीचबीचमा हल्का सुक्दा पिरो बढ्छ। फूल लाग्ने बेला पानी जम्न नदिनुहोस्।',
  ideal: {
    moisture: [55, 70],
    ph: [6.0, 6.8],
    ec: [1.8, 2.8],
    n: [100, 150],
    p: [40, 55],
    k: [150, 220],
    soilTemp: [18, 28],
    airTemp: [20, 30],
  },
  stages: [
    { stage: 'germination', startDay: 0, ideal: { moisture: [65, 80], ec: [1.0, 1.4], n: [60, 90] } },
    { stage: 'vegetative', startDay: 20, ideal: { n: [130, 160], ec: [1.8, 2.3] } },
    { stage: 'flowering', startDay: 45, ideal: { p: [48, 60], k: [170, 210], ec: [2.0, 2.6] } },
    { stage: 'fruiting', startDay: 60, ideal: { k: [190, 240], ec: [2.2, 2.8], n: [100, 130] } },
    { stage: 'harvest', startDay: 85, ideal: { moisture: [50, 65], ec: [1.8, 2.5] } },
  ],
});
