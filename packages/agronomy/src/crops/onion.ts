// 🧅 Onion — bulb, 120 days. Bulb swells in late vegetative; no flowering/fruiting.
import { buildCrop } from './builder';

export const onion = buildCrop({
  id: 'onion',
  nameEn: 'Onion',
  nameNe: 'प्याज',
  emoji: '🧅',
  category: 'bulb',
  daysToHarvest: 120,
  wateringNotesEn:
    'Frequent shallow watering early; stop irrigation as tops fall over and bulbs cure for better storage.',
  wateringNotesNe:
    'सुरुमा बारम्बार हल्का सिंचाइ गर्नुहोस्; माथिल्लो भाग ढल्न थालेपछि र गाँठा परिपक्व हुँदा सिंचाइ रोक्नुहोस्।',
  ideal: {
    moisture: [50, 65],
    ph: [6.0, 7.0],
    ec: [1.2, 2.0],
    n: [80, 130],
    p: [40, 60],
    k: [150, 220],
    soilTemp: [13, 24],
    airTemp: [15, 25],
  },
  stages: [
    { stage: 'germination', startDay: 0, ideal: { moisture: [62, 78], ec: [0.8, 1.2], n: [50, 80] } },
    { stage: 'vegetative', startDay: 25, ideal: { n: [100, 140], ec: [1.4, 1.9] } },
    { stage: 'harvest', startDay: 90, ideal: { k: [170, 230], n: [60, 100], ec: [1.2, 1.8], moisture: [45, 60] } },
  ],
});
