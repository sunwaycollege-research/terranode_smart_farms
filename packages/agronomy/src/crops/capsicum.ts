// 🫑 Capsicum (sweet pepper) — fruiting, 100 days. Fully specified in spec §3.
import { buildCrop } from './builder';

export const capsicum = buildCrop({
  id: 'capsicum',
  nameEn: 'Capsicum',
  nameNe: 'भेडे खुर्सानी',
  emoji: '🫑',
  category: 'fruiting',
  daysToHarvest: 100,
  wateringNotesEn:
    'Consistent moisture during flowering and fruit set; let the top layer dry slightly between waterings to avoid root rot.',
  wateringNotesNe:
    'फूल र फल लाग्ने बेला निरन्तर ओसिलो राख्नुहोस्; जरा कुहिनबाट जोगाउन माथिल्लो तह बीचबीचमा सुक्न दिनुहोस्।',
  ideal: {
    moisture: [55, 70],
    ph: [6.0, 6.8],
    ec: [1.8, 3.0],
    n: [110, 160],
    p: [40, 60],
    k: [150, 220],
    soilTemp: [18, 26],
    airTemp: [20, 28],
  },
  stages: [
    { stage: 'germination', startDay: 0, ideal: { moisture: [65, 80], ec: [1.0, 1.4] } },
    { stage: 'vegetative', startDay: 20, ideal: { n: [130, 160], ec: [1.8, 2.4] } },
    { stage: 'flowering', startDay: 45, ideal: { p: [50, 65], k: [160, 200], ec: [2.0, 2.6] } },
    { stage: 'fruiting', startDay: 60, ideal: { k: [180, 240], ec: [2.4, 3.0] } },
    { stage: 'harvest', startDay: 85, ideal: { ec: [1.8, 2.6] } },
  ],
});
