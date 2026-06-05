// 🍆 Eggplant (Brinjal) — fruiting, 100 days. Whole-crop ideal from spec §3 table.
import { buildCrop } from './builder';

export const eggplant = buildCrop({
  id: 'eggplant',
  nameEn: 'Brinjal',
  nameNe: 'भान्टा',
  emoji: '🍆',
  category: 'fruiting',
  daysToHarvest: 100,
  wateringNotesEn:
    'Deep, regular watering; eggplant is sensitive to drought during fruit set. Keep moisture even to avoid bitterness.',
  wateringNotesNe:
    'गहिरो र नियमित सिंचाइ गर्नुहोस्; फल लाग्ने बेला भान्टा सुख्खा सहन सक्दैन। तीतोपन रोक्न ओसिलोपन समान राख्नुहोस्।',
  ideal: {
    moisture: [60, 75],
    ph: [6.0, 6.8],
    ec: [2.0, 3.0],
    n: [110, 160],
    p: [40, 60],
    k: [160, 230],
    soilTemp: [18, 28],
    airTemp: [22, 30],
  },
  stages: [
    { stage: 'germination', startDay: 0, ideal: { moisture: [68, 82], ec: [1.0, 1.5], n: [60, 90] } },
    { stage: 'vegetative', startDay: 22, ideal: { n: [140, 170], ec: [2.0, 2.5] } },
    { stage: 'flowering', startDay: 45, ideal: { p: [50, 65], k: [180, 220], ec: [2.2, 2.8] } },
    { stage: 'fruiting', startDay: 60, ideal: { k: [200, 260], ec: [2.5, 3.0], moisture: [62, 76] } },
    { stage: 'harvest', startDay: 88, ideal: { ec: [2.0, 2.8], moisture: [58, 72] } },
  ],
});
