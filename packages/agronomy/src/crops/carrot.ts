// 🥕 Carrot — root, 80 days. Root bulks in late vegetative; no flowering/fruiting.
import { buildCrop } from './builder';

export const carrot = buildCrop({
  id: 'carrot',
  nameEn: 'Carrot',
  nameNe: 'गाजर',
  emoji: '🥕',
  category: 'root',
  daysToHarvest: 80,
  wateringNotesEn:
    'Deep, even watering grows straight roots; inconsistent moisture causes splitting and forking. Keep soil loose.',
  wateringNotesNe:
    'गहिरो र समान सिंचाइले सीधा जरा बनाउँछ; असमान ओसिलोपनले फुट्ने र हाँगा हाल्ने बनाउँछ। माटो खुकुलो राख्नुहोस्।',
  ideal: {
    moisture: [55, 70],
    ph: [6.0, 6.8],
    ec: [1.0, 2.0],
    n: [70, 110],
    p: [45, 65],
    k: [170, 250],
    soilTemp: [10, 22],
    airTemp: [15, 24],
  },
  stages: [
    { stage: 'germination', startDay: 0, ideal: { moisture: [65, 80], ec: [0.7, 1.1], n: [40, 70] } },
    { stage: 'vegetative', startDay: 18, ideal: { n: [90, 120], ec: [1.2, 1.8] } },
    { stage: 'harvest', startDay: 60, ideal: { k: [190, 260], n: [60, 90], ec: [1.0, 1.7], moisture: [52, 66] } },
  ],
});
