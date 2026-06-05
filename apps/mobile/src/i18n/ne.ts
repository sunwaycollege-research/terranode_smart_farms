// Nepali (नेपाली) bundle. Same key set as en.ts — keep them in sync.
import type { TranslationKey } from './en';

export const ne: Record<TranslationKey, string> = {
  // common -------------------------------------------------------------------
  'common.appName': 'TERANODE',
  'common.tagline': 'क्षेत्रगत माटो बुद्धिमत्ता · मलजल · खेत नियन्त्रण',
  'common.signIn': 'साइन इन',
  'common.signingIn': 'साइन इन हुँदै…',
  'common.signOut': 'साइन आउट',
  'common.email': 'इमेल',
  'common.password': 'पासवर्ड',
  'common.cancel': 'रद्द',
  'common.save': 'सुरक्षित',
  'common.saving': 'सुरक्षित हुँदै…',
  'common.done': 'भयो',
  'common.next': 'अर्को',
  'common.back': 'पछाडि',
  'common.retry': 'पुनः प्रयास',
  'common.loading': 'लोड हुँदै…',
  'common.error': 'केही गडबड भयो',
  'common.search': 'खोज्नुहोस्',
  'common.on': 'सक्रिय',
  'common.off': 'निष्क्रिय',
  'common.auto': 'स्वतः',
  'common.manual': 'म्यानुअल',
  'common.open': 'खोल्नुहोस्',
  'common.close': 'बन्द',
  'common.day': 'दिन',
  'common.days': 'दिन',
  'common.kg': 'के.जी.',
  'common.liters': 'लि.',

  // tabs ---------------------------------------------------------------------
  'tabs.field': 'खेत',
  'tabs.analytics': 'विश्लेषण',
  'tabs.alerts': 'सूचना',
  'tabs.account': 'खाता',
  'tabs.history': 'इतिहास',

  // auth ---------------------------------------------------------------------
  'auth.signInTitle': 'साइन इन',
  'auth.demoTitle': 'डेमो खाता',
  'auth.demoSubtitle': 'डेमो किसानको रूपमा साइन इन गर्न ट्याप गर्नुहोस्।',
  'auth.demoFarmer': '🌱  किसान (ग्रीन भ्याली फार्म)',
  'auth.invalid': 'साइन इन गर्न सकिएन। इमेल र पासवर्ड जाँच गर्नुहोस्।',

  // admin notice -------------------------------------------------------------
  'admin.noticeTitle': 'एड्मिन कन्सोल वेबमा छ',
  'admin.noticeBody':
    'यो खाता TERANODE एड्मिनिस्ट्रेटर हो। फ्लीट व्यवस्थापन, ग्राहक, बाली र अडिट वेब कन्सोलमा छ।',
  'admin.noticeUrl': 'डेस्कटप ब्राउजरमा वेब कन्सोल खोल्नुहोस्।',
  'admin.signOut': 'साइन आउट',

  // field / dashboard --------------------------------------------------------
  'field.title': 'खेत',
  'field.zones': 'क्षेत्रहरू',
  'field.systems': 'प्रणाली',
  'field.weather': 'मौसम',
  'field.health': 'स्वास्थ्य',
  'field.addZone': 'क्षेत्र थप्नुहोस्',
  'field.noZones': 'अहिलेसम्म कुनै क्षेत्र छैन — निगरानी सुरु गर्न आफ्नो पहिलो क्षेत्र थप्नुहोस्।',
  'field.pump': 'मुख्य पम्प',
  'field.dosing': 'मलजल',
  'field.reservoir': 'जलाशय',
  'field.flow': 'बहाव',
  'field.watering': 'सिँचाइ हुँदै',
  'field.idle': 'निष्क्रिय',

  // zone detail --------------------------------------------------------------
  'zone.moisture': 'चिस्यान',
  'zone.ph': 'पिएच',
  'zone.ec': 'ईसी',
  'zone.nitrogen': 'नाइट्रोजन (N)',
  'zone.phosphorus': 'फस्फोरस (P)',
  'zone.potassium': 'पोटासियम (K)',
  'zone.soilTemp': 'माटोको तापक्रम',
  'zone.airTemp': 'हावाको तापक्रम',
  'zone.target': 'लक्ष्य',
  'zone.valve': 'भल्भ',
  'zone.mode': 'मोड',
  'zone.coach': 'सल्लाह',
  'zone.stage': 'चरण',
  'zone.dayOf': '{{total}} मध्ये दिन {{day}}',
  'zone.below': 'कम',
  'zone.in': 'दायरामा',
  'zone.above': 'बढी',
  'zone.pending': 'पर्खँदै…',

  // add / assign zone --------------------------------------------------------
  'assign.title': 'क्षेत्र थप्नुहोस्',
  'assign.pickCrop': 'बाली छान्नुहोस्',
  'assign.allCategories': 'सबै',
  'assign.plantingDate': 'रोपेको मिति',
  'assign.bindNode': 'सेन्सर नोड जोड्नुहोस्',
  'assign.channels': 'सेन्सर च्यानल',
  'assign.climateFit': 'हावापानी उपयुक्तता',
  'assign.create': 'क्षेत्र सिर्जना',
  'assign.zoneName': 'क्षेत्रको नाम',

  // crop categories ----------------------------------------------------------
  'cat.fruiting': 'फलफूल',
  'cat.leafy': 'पाते',
  'cat.root': 'जरा',
  'cat.bulb': 'गानो',
  'cat.legume': 'दलहन',
  'cat.brassica': 'बन्दागोभी वर्ग',

  // growth stages ------------------------------------------------------------
  'stage.germination': 'अंकुरण',
  'stage.vegetative': 'वानस्पतिक',
  'stage.flowering': 'फुल्ने',
  'stage.fruiting': 'फल्ने',
  'stage.harvest': 'बाली काट्ने',

  // analytics ----------------------------------------------------------------
  'analytics.title': 'विश्लेषण',
  'analytics.water': 'पानी खपत',
  'analytics.fertilizer': 'मल खपत',
  'analytics.savings': 'आधाररेखा तुलनामा बचत',
  'analytics.saved': 'बचत',
  'analytics.harvest': 'बाली रेकर्ड',
  'analytics.yield': 'उत्पादन',
  'analytics.export': 'CSV निर्यात',
  'analytics.share': 'सेयर',
  'analytics.noData': 'यो अवधिको लागि अहिलेसम्म डाटा छैन।',

  // history ------------------------------------------------------------------
  'history.title': 'इतिहास',
  'history.range': 'अवधि',

  // alerts -------------------------------------------------------------------
  'alerts.title': 'सूचना',
  'alerts.none': 'कुनै सूचना छैन — सबै स्वस्थ देखिन्छ।',
  'alerts.ack': 'स्वीकार',
  'alerts.acked': 'स्वीकृत',
  'alerts.info': 'जानकारी',
  'alerts.warn': 'चेतावनी',
  'alerts.critical': 'गम्भीर',

  // account ------------------------------------------------------------------
  'account.title': 'खाता',
  'account.plan': 'तपाईंको योजना र उपकरण',
  'account.language': 'भाषा',
  'account.fieldMode': 'फिल्ड मोड',
  'account.fieldModeHint': 'खेतमा प्रयोगका लागि ठूलो अक्षर र टच लक्ष्य।',
  'account.english': 'English',
  'account.nepali': 'नेपाली',
};
