// 🌿 Okra — fruiting, 60 days. Warm-season; whole-crop ideal from spec §3 table.
import { buildCrop } from './builder';

export const okra = buildCrop({
  id: 'okra',
  nameEn: 'Okra',
  nameNe: 'भिन्डी',
  emoji: '🌿',
  category: 'fruiting',
  daysToHarvest: 60,
  wateringNotesEn:
    'Drought-tolerant but yields best with steady moisture during podding; water deeply once topsoil dries.',
  wateringNotesNe:
    'सुख्खा सहन सक्ने भए पनि फल लाग्ने बेला स्थिर ओसिलोपनले राम्रो उत्पादन दिन्छ; माथिल्लो माटो सुकेपछि गहिरो सिंचाइ गर्नुहोस्।',
  ideal: {
    moisture: [55, 70],
    ph: [6.0, 6.8],
    ec: [1.5, 2.5],
    n: [90, 140],
    p: [35, 55],
    k: [140, 200],
    soilTemp: [20, 30],
    airTemp: [24, 32],
  },
  stages: [
    { stage: 'germination', startDay: 0, ideal: { moisture: [65, 80], ec: [0.9, 1.3], n: [50, 80] } },
    { stage: 'vegetative', startDay: 15, ideal: { n: [120, 150], ec: [1.5, 2.0] } },
    { stage: 'flowering', startDay: 32, ideal: { p: [45, 58], k: [160, 200], ec: [1.8, 2.3] } },
    { stage: 'fruiting', startDay: 45, ideal: { k: [180, 220], ec: [2.0, 2.5], moisture: [58, 72] } },
    { stage: 'harvest', startDay: 52, ideal: { ec: [1.6, 2.2] } },
  ],
});
