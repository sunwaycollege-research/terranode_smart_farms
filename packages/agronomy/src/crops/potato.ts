// 🥔 Potato — root (tuber), 100 days. Tubers bulk in late vegetative; no flowering/fruiting stage modeled.
import { buildCrop } from './builder';

export const potato = buildCrop({
  id: 'potato',
  nameEn: 'Potato',
  nameNe: 'आलु',
  emoji: '🥔',
  category: 'root',
  daysToHarvest: 100,
  wateringNotesEn:
    'Consistent moisture during tuber bulking maximizes yield and prevents knobbly tubers; ease off before harvest to firm skins.',
  wateringNotesNe:
    'गाँठा बढ्ने बेला निरन्तर ओसिलोपनले उत्पादन बढाउँछ; कटाइ अघि बोक्रा कडा बनाउन सिंचाइ घटाउनुहोस्।',
  ideal: {
    moisture: [60, 75],
    ph: [5.0, 6.5],
    ec: [1.5, 2.5],
    n: [110, 160],
    p: [50, 70],
    k: [200, 300],
    soilTemp: [12, 22],
    airTemp: [15, 24],
  },
  stages: [
    { stage: 'germination', startDay: 0, ideal: { moisture: [62, 78], ec: [1.0, 1.5], n: [70, 100] } },
    { stage: 'vegetative', startDay: 25, ideal: { n: [140, 170], ec: [1.6, 2.2] } },
    { stage: 'harvest', startDay: 70, ideal: { k: [230, 320], n: [90, 130], ec: [1.5, 2.3], moisture: [55, 70] } },
  ],
});
