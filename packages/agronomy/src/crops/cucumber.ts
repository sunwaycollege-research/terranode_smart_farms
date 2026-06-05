// 🥒 Cucumber — fruiting vine, 60 days. Fully specified in spec §3.
import { buildCrop } from './builder';

export const cucumber = buildCrop({
  id: 'cucumber',
  nameEn: 'Cucumber',
  nameNe: 'काँक्रो',
  emoji: '🥒',
  category: 'fruiting',
  daysToHarvest: 60,
  wateringNotesEn:
    'High, steady moisture during fruiting; uneven watering causes bitter, misshapen fruit. Water at the base, not the leaves.',
  wateringNotesNe:
    'फल लाग्ने बेला उच्च र स्थिर ओसिलोपन चाहिन्छ; असमान सिंचाइले तीतो र बाङ्गो फल बनाउँछ। पातमा होइन फेदमा पानी हाल्नुहोस्।',
  ideal: {
    moisture: [65, 80],
    ph: [5.8, 6.8],
    ec: [1.8, 2.8],
    n: [120, 170],
    p: [40, 60],
    k: [160, 230],
    soilTemp: [18, 28],
    airTemp: [22, 30],
  },
  stages: [
    { stage: 'germination', startDay: 0, ideal: { moisture: [70, 85], ec: [1.0, 1.4] } },
    { stage: 'vegetative', startDay: 15, ideal: { n: [150, 170], ec: [1.8, 2.2] } },
    { stage: 'flowering', startDay: 30, ideal: { p: [50, 65], k: [170, 210] } },
    { stage: 'fruiting', startDay: 40, ideal: { k: [190, 250], moisture: [70, 82], ec: [2.2, 2.8] } },
  ],
});
