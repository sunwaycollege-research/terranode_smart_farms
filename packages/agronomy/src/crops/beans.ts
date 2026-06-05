// 🫘 Beans — legume, 60 days. Nitrogen-fixing, so N targets stay modest.
import { buildCrop } from './builder';

export const beans = buildCrop({
  id: 'beans',
  nameEn: 'Beans',
  nameNe: 'सिमी',
  emoji: '🫘',
  category: 'legume',
  daysToHarvest: 60,
  wateringNotesEn:
    'Even moisture at flowering and pod fill is critical; legumes fix their own nitrogen, so avoid heavy N feeding.',
  wateringNotesNe:
    'फूल र कोसा भरिने बेला समान ओसिलोपन अत्यावश्यक छ; सिमीले आफैं नाइट्रोजन बनाउने हुनाले बढी नाइट्रोजन नदिनुहोस्।',
  ideal: {
    moisture: [55, 70],
    ph: [6.0, 7.0],
    ec: [1.0, 1.8],
    n: [40, 80],
    p: [40, 60],
    k: [120, 180],
    soilTemp: [16, 26],
    airTemp: [18, 28],
  },
  stages: [
    { stage: 'germination', startDay: 0, ideal: { moisture: [62, 78], ec: [0.7, 1.1], n: [30, 55] } },
    { stage: 'vegetative', startDay: 14, ideal: { n: [50, 80], ec: [1.0, 1.5] } },
    { stage: 'flowering', startDay: 32, ideal: { p: [50, 65], k: [140, 180], ec: [1.2, 1.7] } },
    { stage: 'fruiting', startDay: 42, ideal: { k: [150, 200], ec: [1.3, 1.8], moisture: [58, 72] } },
    { stage: 'harvest', startDay: 52, ideal: { ec: [1.0, 1.6] } },
  ],
});
