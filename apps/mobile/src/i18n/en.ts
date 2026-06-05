// English bundle for the TERANODE customer app.
// Keys are grouped by screen/area; values are flat strings (no nesting) so
// useT('field.title') style lookups stay simple and translator-friendly.

export const en = {
  // common -------------------------------------------------------------------
  'common.appName': 'TERANODE',
  'common.tagline': 'Zoned soil intelligence · fertigation · field control',
  'common.signIn': 'Sign in',
  'common.signingIn': 'Signing in…',
  'common.signOut': 'Sign out',
  'common.email': 'email',
  'common.password': 'password',
  'common.cancel': 'Cancel',
  'common.save': 'Save',
  'common.saving': 'Saving…',
  'common.done': 'Done',
  'common.next': 'Next',
  'common.back': 'Back',
  'common.retry': 'Retry',
  'common.loading': 'Loading…',
  'common.error': 'Something went wrong',
  'common.search': 'Search',
  'common.on': 'on',
  'common.off': 'off',
  'common.auto': 'Auto',
  'common.manual': 'Manual',
  'common.open': 'Open',
  'common.close': 'Close',
  'common.day': 'day',
  'common.days': 'days',
  'common.kg': 'kg',
  'common.liters': 'L',

  // tabs ---------------------------------------------------------------------
  'tabs.field': 'Field',
  'tabs.analytics': 'Analytics',
  'tabs.alerts': 'Alerts',
  'tabs.account': 'Account',
  'tabs.history': 'History',

  // auth ---------------------------------------------------------------------
  'auth.signInTitle': 'Sign in',
  'auth.demoTitle': 'Demo account',
  'auth.demoSubtitle': 'Tap to sign in as the demo farmer.',
  'auth.demoFarmer': '🌱  Farmer (Green Valley Farm)',
  'auth.invalid': 'Could not sign in. Check your email and password.',

  // admin notice -------------------------------------------------------------
  'admin.noticeTitle': 'Admin console is on the web',
  'admin.noticeBody':
    'This account is a TERANODE administrator. Fleet management, customers, crops and audit live in the web console.',
  'admin.noticeUrl': 'Open the web console on a desktop browser.',
  'admin.signOut': 'Sign out',

  // field / dashboard --------------------------------------------------------
  'field.title': 'Field',
  'field.zones': 'Zones',
  'field.systems': 'Systems',
  'field.weather': 'Weather',
  'field.health': 'Health',
  'field.addZone': 'Add zone',
  'field.noZones': 'No zones yet — add your first zone to start monitoring.',
  'field.pump': 'Main pump',
  'field.dosing': 'Fertigation',
  'field.reservoir': 'Reservoir',
  'field.flow': 'Flow',
  'field.watering': 'Watering',
  'field.idle': 'Idle',

  // zone detail --------------------------------------------------------------
  'zone.moisture': 'Moisture',
  'zone.ph': 'pH',
  'zone.ec': 'EC',
  'zone.nitrogen': 'Nitrogen (N)',
  'zone.phosphorus': 'Phosphorus (P)',
  'zone.potassium': 'Potassium (K)',
  'zone.soilTemp': 'Soil temp',
  'zone.airTemp': 'Air temp',
  'zone.target': 'Target',
  'zone.valve': 'Valve',
  'zone.mode': 'Mode',
  'zone.coach': 'Coach',
  'zone.stage': 'Stage',
  'zone.dayOf': 'Day {{day}} of {{total}}',
  'zone.below': 'below',
  'zone.in': 'in range',
  'zone.above': 'above',
  'zone.pending': 'Pending…',

  // add / assign zone --------------------------------------------------------
  'assign.title': 'Add zone',
  'assign.pickCrop': 'Pick a crop',
  'assign.allCategories': 'All',
  'assign.plantingDate': 'Planting date',
  'assign.bindNode': 'Bind sensor node',
  'assign.channels': 'Sensor channels',
  'assign.climateFit': 'Climate fit',
  'assign.create': 'Create zone',
  'assign.zoneName': 'Zone name',

  // crop categories ----------------------------------------------------------
  'cat.fruiting': 'Fruiting',
  'cat.leafy': 'Leafy',
  'cat.root': 'Root',
  'cat.bulb': 'Bulb',
  'cat.legume': 'Legume',
  'cat.brassica': 'Brassica',

  // growth stages ------------------------------------------------------------
  'stage.germination': 'Germination',
  'stage.vegetative': 'Vegetative',
  'stage.flowering': 'Flowering',
  'stage.fruiting': 'Fruiting',
  'stage.harvest': 'Harvest',

  // analytics ----------------------------------------------------------------
  'analytics.title': 'Analytics',
  'analytics.water': 'Water usage',
  'analytics.fertilizer': 'Fertilizer usage',
  'analytics.savings': 'Savings vs baseline',
  'analytics.saved': 'saved',
  'analytics.harvest': 'Harvest log',
  'analytics.yield': 'Yield',
  'analytics.export': 'Export CSV',
  'analytics.share': 'Share',
  'analytics.noData': 'No data for this range yet.',

  // history ------------------------------------------------------------------
  'history.title': 'History',
  'history.range': 'Range',

  // alerts -------------------------------------------------------------------
  'alerts.title': 'Alerts',
  'alerts.none': 'No alerts — everything looks healthy.',
  'alerts.ack': 'Acknowledge',
  'alerts.acked': 'Acknowledged',
  'alerts.info': 'Info',
  'alerts.warn': 'Warning',
  'alerts.critical': 'Critical',

  // account ------------------------------------------------------------------
  'account.title': 'Account',
  'account.plan': 'Your plan & devices',
  'account.language': 'Language',
  'account.fieldMode': 'Field mode',
  'account.fieldModeHint': 'Larger text and touch targets for use in the field.',
  'account.english': 'English',
  'account.nepali': 'नेपाली',
} as const;

export type TranslationKey = keyof typeof en;
