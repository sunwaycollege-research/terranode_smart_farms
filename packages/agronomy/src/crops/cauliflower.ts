// 🥦 Cauliflower — brassica, 80 days. Curd forms in late vegetative; no fruiting.
import { buildCrop } from './builder';

export const cauliflower = buildCrop({
  id: 'cauliflower',
  nameEn: 'Cauliflower',
  nameNe: 'काउली',
  emoji: '🥦',
  category: 'brassica',
  daysToHarvest: 80,
  wateringNotesEn:
    'Uninterrupted moisture is essential for tight white curds; any stress causes loose, ricey heads. Shade curds from sun.',
  wateringNotesNe:
    'सेतो र कसिलो काउलीको लागि निरन्तर ओसिलोपन अत्यावश्यक छ; तनाव हुँदा खुकुलो टाउको बन्छ। टाउकोलाई घामबाट छेकनुहोस्।',
  ideal: {
    moisture: [60, 75],
    ph: [6.0, 7.0],
    ec: [1.5, 2.5],
    n: [130, 190],
    p: [45, 65],
    k: [160, 230],
    soilTemp: [12, 22],
    airTemp: [15, 24],
  },
  stages: [
    { stage: 'germination', startDay: 0, ideal: { moisture: [68, 82], ec: [0.9, 1.3], n: [75, 105] } },
    { stage: 'vegetative', startDay: 20, ideal: { n: [160, 200], ec: [1.6, 2.2] } },
    { stage: 'harvest', startDay: 62, ideal: { k: [180, 240], p: [50, 68], ec: [1.5, 2.2], moisture: [58, 72] } },
  ],
});
