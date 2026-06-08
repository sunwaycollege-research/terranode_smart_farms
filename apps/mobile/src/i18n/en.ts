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
  'field.gateway': 'ESP32 Gateway',
  'field.gatewayOnline': 'Gateway online',
  'field.gatewayOffline': 'Gateway offline',
  'field.gatewayClaimed': 'Gateway claimed · awaiting first boot',
  'field.gatewayNone': 'No gateway',
  'field.offlineCached': 'Offline · cached',
  'field.offlineNotice':
    'Showing the last cached field overview. Irrigation keeps running on the gateway; readings refresh when you reconnect.',
  'field.noFarmTitle': 'No farm set up yet',
  'field.noFarmBody':
    'Your device and live readings will appear here once it is registered and powered on.',
  'field.loadError': "Couldn't load your field. Check your connection and try again.",
  'field.zonesHint': 'Tap a zone to inspect readings, targets and the valve.',

  // water status -------------------------------------------------------------
  'water.title': 'Water',
  'water.flowing': 'Water flowing: {{lpm}} L/min',
  'water.flowingHint': 'Your crops are being watered now.',
  'water.none': 'No watering right now',
  'water.leak': 'Pump is on but no water is flowing — check the pump or pipe.',
  'water.rain': 'Raining — watering paused to save water.',

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
  'zone.status': 'Soil status',
  'zone.valve': 'Valve',
  'zone.mode': 'Mode',
  'zone.coach': 'Coach',
  'zone.stage': 'Stage',
  'zone.dayOf': 'Day {{day}} of {{total}}',
  'zone.below': 'below',
  'zone.in': 'in range',
  'zone.above': 'above',
  'zone.pending': 'Pending…',
  'zone.notFound': 'Zone not found. It may have been removed.',
  'zone.loadError': 'Could not load this zone.',
  'zone.needsCropTitle': 'Pick a crop for this zone',
  'zone.needsCropBody': 'This zone has no crop yet. Choose what you’re growing so TERANODE can set the right targets and start tracking its health.',
  'zone.assignCrop': 'Choose a crop',
  'zone.valveHint':
    'The gateway runs the control loop locally. Switch to Manual to override — the app shows the device’s reported state, not just your request.',
  'zone.noValve': 'No valve bound to this zone yet.',

  // soil nutrients card ------------------------------------------------------
  'nutrient.title': 'Soil nutrients',
  'nutrient.subtitle': 'What your soil needs right now.',
  'nutrient.empty': 'No soil readings yet — values appear once your probe reports.',
  'nutrient.approx': 'N · P · K are quick estimates from the soil probe — use as a guide; confirm with a lab test before heavy fertilising.',
  'fertilizer.title': 'Fertilizer plan',
  'nutrient.low': 'LOW',
  'nutrient.ok': 'OK',
  'nutrient.high': 'HIGH',
  'nutrient.unit.npk': 'mg/kg',
  'nutrient.unit.ec': 'mS/cm',
  // plain one-line hints (no jargon)
  'nutrient.n.low': 'Nitrogen low — add compost or urea.',
  'nutrient.n.ok': 'Nitrogen is good.',
  'nutrient.n.high': 'Nitrogen high — hold off on nitrogen feed.',
  'nutrient.p.low': 'Phosphorus low — add bone meal or DAP.',
  'nutrient.p.ok': 'Phosphorus is good.',
  'nutrient.p.high': 'Phosphorus high — skip phosphate feed.',
  'nutrient.k.low': 'Potassium low — add wood ash or potash.',
  'nutrient.k.ok': 'Potassium is good.',
  'nutrient.k.high': 'Potassium high — skip potash feed.',
  'nutrient.ph.low': 'Soil is acidic — add lime.',
  'nutrient.ph.ok': 'pH is good.',
  'nutrient.ph.high': 'Soil is alkaline — add compost or sulphur.',
  'nutrient.ec.low': 'Soil is low on feed — add fertilizer.',
  'nutrient.ec.ok': 'Salt level is good.',
  'nutrient.ec.high': 'Too much salt — flush with plain water.',

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
  'assign.quota': '{{used}} of {{cap}} sensor nodes used',
  'assign.atCapTitle': 'All your nodes are in use',
  'assign.atCapBody':
    'You have set up {{used}} of {{cap}} zones — one per sensor node you bought. Add another node kit to create more zones.',
  'assign.noFarmBody': 'No farm is set up for your account yet.',
  'assign.noCrops': 'No crops found. Pull to refresh or check your connection.',

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
  'analytics.noUsage': 'No usage data yet.',
  'analytics.noFarm': 'No farm set up yet — once your farm and zones are configured, your usage and savings will appear here.',

  // history ------------------------------------------------------------------
  'history.title': 'History',
  'history.range': 'Range',
  'history.subtitle': 'Sensor rollups — average with the min/max range per bucket.',
  'history.noFarm': 'No farm set up yet — once your farm and zones are configured, your sensor history appears here.',
  'history.empty': 'No history yet — readings appear as your device reports.',
  'history.error': 'Could not load history.',
  'history.channel': 'Channel',

  // alerts -------------------------------------------------------------------
  'alerts.title': 'Alerts',
  'alerts.none': 'No alerts — everything looks healthy.',
  'alerts.ack': 'Acknowledge',
  'alerts.acked': 'Acknowledged',
  'alerts.info': 'Info',
  'alerts.warn': 'Warning',
  'alerts.critical': 'Critical',
  'alerts.error': 'Could not load alerts.',
  'alerts.pushNote': 'Push notifications arrive here too.',

  // account ------------------------------------------------------------------
  'account.title': 'Account',
  'account.plan': 'Your plan & devices',
  'account.language': 'Language',
  'account.fieldMode': 'Field mode',
  'account.fieldModeHint': 'Larger text and touch targets for use in the field.',
  'account.english': 'English',
  'account.nepali': 'नेपाली',
  'account.roleAdmin': 'Administrator',
  'account.roleCustomer': 'Farmer',
  'account.devicesLoading': 'Loading your plan…',
  'account.devicesError': 'Could not load your plan & devices.',
  'account.devicesEmpty': 'No devices on your plan yet.',
  'account.addDevice': '+ Add a device',

  // device onboarding --------------------------------------------------------
  'onboard.title': 'Add a device',
  'onboard.step': 'Step {{step}} of {{total}}',

  // step 1 — power on
  'onboard.step1Title': 'Power on your TERANODE box',
  'onboard.step1Body': 'Plug in your TERANODE box. Wait until the light turns on and stays steady.',
  'onboard.step1Hint': 'This can take up to a minute.',

  // step 2 — wifi setup
  'onboard.step2Title': 'Connect to the box',
  'onboard.step2Body': 'Open your phone’s WiFi settings and connect to the network named TERANODE-XXXX.',
  'onboard.step2Body2': 'A setup page will open. Choose your home WiFi and type its password.',
  'onboard.step2Hint': 'Then come back here and tap Next.',
  'onboard.openWifi': 'Open WiFi settings',

  // step 3 — waiting / connected
  'onboard.waitingTitle': 'Waiting for your device…',
  'onboard.waitingBody': 'Keep your box powered on. This page updates by itself.',
  'onboard.connectedTitle': 'Your device is connected!',
  'onboard.connectedBody': 'Your TERANODE box is online and sending readings.',
  'onboard.goDashboard': 'Go to my field',
  'onboard.tryAgain': 'Check again',

  // step nav
  'onboard.start': 'Start',
} as const;

export type TranslationKey = keyof typeof en;
