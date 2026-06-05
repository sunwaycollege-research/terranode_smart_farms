// 🥬 Cabbage — brassica, 75 days. Heads form in late vegetative; no fruiting.
import { buildCrop } from './builder';

export const cabbage = buildCrop({
  id: 'cabbage',
  nameEn: 'Cabbage',
  nameNe: 'बन्दा',
  emoji: '🥬',
  category: 'brassica',
  daysToHarvest: 75,
  wateringNotesEn:
    'Steady moisture during head formation prevents splitting; reduce watering as heads firm up before harvest.',
  wateringNotesNe:
    'टाउको बन्ने बेला स्थिर ओसिलोपनले फुट्नबाट जोगाउँछ; टाउको कडा भएपछि कटाइ अघि सिंचाइ घटाउनुहोस्।',
  ideal: {
    moisture: [60, 75],
    ph: [6.0, 7.0],
    ec: [1.5, 2.5],
    n: [120, 180],
    p: [40, 60],
    k: [150, 220],
    soilTemp: [12, 22],
    airTemp: [15, 25],
  },
  stages: [
    { stage: 'germination', startDay: 0, ideal: { moisture: [68, 82], ec: [0.9, 1.3], n: [70, 100] } },
    { stage: 'vegetative', startDay: 18, ideal: { n: [150, 190], ec: [1.6, 2.2] } },
    { stage: 'harvest', startDay: 60, ideal: { k: [170, 230], ec: [1.5, 2.2], moisture: [58, 72] } },
  ],
});
