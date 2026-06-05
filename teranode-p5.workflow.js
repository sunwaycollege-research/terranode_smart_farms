export const meta = {
  name: 'teranode-p5-clients',
  description: 'Phase 5 — build the React (Vite) web admin and the React Native (Expo) customer app for TERANODE. Two parallel tracks; schema-less agents (operator verifies builds inline).',
  phases: [
    { title: 'P5 Web', detail: 'Vite admin: scaffold then 4 page units' },
    { title: 'P5 Mobile', detail: 'role trim -> api seam -> components -> screens' },
  ],
}

const SPEC = 'docs/BUILD-SPEC.md'
const PRE =
  'You are one autonomous build agent for TERANODE. Repo root is your cwd (NOT git). FIRST read ' + SPEC +
  ' fully — especially section 7 (client screen lists), section 5 (API surface the clients call), section 1 (2-role ' +
  'model), and section 8 (file-ownership map). The BACKEND IS DONE and RUNS at http://localhost:4000 (REST + WS /live), ' +
  'backed by Postgres/Timescale; demo logins admin@teranode.io and farmer@greenvalley.np (password teranode). Shared types ' +
  'are in @teranode/types (entities, DTOs for every endpoint, enums) and the crop library + agronomy engine in ' +
  '@teranode/agronomy (analyzeZone, crops, zoneHealth, etc.) — IMPORT from these, do not re-derive. READ the existing ' +
  'design tokens at apps/mobile/src/theme/tokens.ts (parchment + soil palette: bg #f6f3ec, primary #3f6b4e forest, accent ' +
  '#bd6a43 terracotta, watering #3f78c9, healthy #3fa564, dry #d9a23b, critical #c14a3b; fonts Instrument Serif display / ' +
  'Geist UI / JetBrains Mono numbers) and reuse that visual language. RULES: extensionless imports in shared packages; do ' +
  'NOT run npm install or add new deps (web has react18+react-router-dom6+i18next+react-i18next+recharts+vite; mobile has ' +
  'expo SDK55 + react-native-svg + i18next + react-i18next + async-storage); write ONLY the files your unit owns (see your ' +
  'unit + section 8); write complete, polished, working UI — not stubs. Make your workspace build: web units run ' +
  '"npm run -w @teranode/web build"; mobile units run "npm run -w @teranode/mobile typecheck" (Metro tolerates loose types ' +
  'but keep it clean). Return a brief plain-text summary of what you built and any follow-ups (no special format needed).'

// schema-less on purpose: a build agent that finishes files but does not emit a
// structured object must NOT abort the workflow.
const unit = (label, phase, instructions) =>
  agent(PRE + '\n\n## YOUR UNIT: ' + label + '\n' + instructions, { label, phase })

async function webTrack() {
  await unit('5.W0 web scaffold', 'P5 Web',
    'Scaffold the apps/web Vite+React18+TS admin (role=admin). Create: vite.config.ts (@vitejs/plugin-react; define ' +
    'server.port 5173; expose VITE_API_URL with default http://localhost:4000), index.html, src/main.tsx, src/App.tsx, ' +
    'src/router.tsx (react-router-dom v6: /login (public) + a protected AdminLayout shell with a left nav linking ' +
    'Customers, Fleet, Crops, Audit, Analytics; redirect unauthenticated users to /login; store the JWT in localStorage ' +
    'and attach it as Bearer on every request; on 401 clear + redirect), src/api/client.ts (a typed fetch wrapper using ' +
    '@teranode/types DTOs covering the admin + crops + analytics endpoints in spec section 5; base = import.meta.env.' +
    'VITE_API_URL; login/refresh/logout; getMe), src/auth/AuthContext.tsx (login form posts /auth/login, stores tokens, ' +
    'exposes user/role), src/theme/ (tokens.css with CSS variables porting the parchment+soil palette + a small global ' +
    'stylesheet; load the three Google fonts via index.html link tags), src/i18n/ (i18next + react-i18next, en + ne ' +
    'resource bundles + a language switcher hook), and src/components/ (Button, Card, Table, Toggle/Switch, TextField, ' +
    'Select, Stat, PageHeader, NavSidebar, Badge). Create MINIMAL placeholder pages src/pages/{customers,fleet,crops,' +
    'audit,analytics}/index.tsx (just a PageHeader) so the router resolves — units W1-W4 OVERWRITE these. Add a ' +
    '"typecheck": "tsc --noEmit" script to apps/web/package.json. Your build MUST pass: npm run -w @teranode/web build.')
  return await parallel([
    () => unit('5.W1 customers + entitlement editor', 'P5 Web',
      'Overwrite apps/web/src/pages/customers/**. (1) Customers list: GET /admin/customers, table with name/status/plan + ' +
      'search; row click → detail. (2) Create-customer wizard: name + owner email + password + a grid of device-catalog ' +
      'module toggles/steppers fetched from GET /device-catalog (count modules like zoneNodes use a stepper; toggles use a ' +
      'switch), submit POST /admin/customers; show the returned owner credentials. NO lock UI (admin can always edit). ' +
      '(3) Customer detail: account info, farms/gateways summary, and a freely-editable entitlement editor (PATCH ' +
      '/admin/customers/:id/entitlements) + enable/disable (PATCH /admin/customers/:id). Use src/api/client + components + ' +
      'i18n. Build must pass: npm run -w @teranode/web build.'),
    () => unit('5.W2 fleet + gateways + OTA', 'P5 Web',
      'Overwrite apps/web/src/pages/fleet/**. Gateway fleet table from GET /admin/fleet (serial, online/offline/unbound ' +
      'status with colored badge, last-seen, fw version, bound farm + customer, node battery). A Register-gateway form ' +
      '(serial → POST /admin/gateways, surface the one-time device token). A Bind action (POST /admin/gateways/:id/bind to ' +
      'a farm). An OTA panel (POST /admin/gateways/:id/ota with a target fw version). Build must pass.'),
    () => unit('5.W3 crops admin', 'P5 Web',
      'Overwrite apps/web/src/pages/crops/**. Crop-library table from GET /crops (emoji, names en/ne, category, ' +
      'days-to-harvest, ideal bands summary). A detail/editor drawer showing per-stage bands (crop_stages) and an ' +
      'add/edit crop form (POST /crops, PATCH /crops/:id, PATCH /crops/:id/stages) with the 8-channel CropBand range ' +
      'inputs. Use @teranode/types Crop/CropBand shapes. Build must pass.'),
    () => unit('5.W4 audit + analytics', 'P5 Web',
      'Overwrite apps/web/src/pages/{audit,analytics}/**. Audit: GET /admin/audit table (actor, action, target, time, ' +
      'before/after diff on expand). Analytics: a farm picker + recharts charts for GET /analytics/usage (water/dose per ' +
      'day) and a savings stat card from GET /analytics/savings. Build must pass.'),
  ])
}

async function mobileTrack() {
  await unit('5.M0 mobile role trim + providers', 'P5 Mobile',
    'Refactor apps/mobile to 2 roles, KEEPING it on the mock (app.json extra.useMockApi stays true for now). Steps: ' +
    '(1) DELETE app/(company)/ and app/(retailer)/ entirely (rm the folders). (2) RENAME app/(farmer)/ to app/(customer)/ ' +
    '— move every file (mkdir app/(customer); git-less mv each: _layout.tsx, dashboard.tsx, history.tsx, alerts.tsx, ' +
    'account.tsx, zones/[zoneId].tsx). (3) Rewrite app/(customer)/_layout.tsx tabs for the customer app (Field, Analytics, ' +
    'Alerts, Account; plus the hidden zones/[zoneId] + zones/new routes). (4) Rewrite app/_layout.tsx to declare only ' +
    '(auth) + (customer) and WRAP the tree in your new I18nProvider (from src/i18n) and FieldModeProvider (from ' +
    'src/theme/scale). (5) Rewrite app/index.tsx for a 2-role redirect (customer → /(customer)/dashboard; admin → an ' +
    'in-app notice screen saying admin uses the web console). (6) Update src/auth/AuthContext.tsx: roles are admin|customer, ' +
    'homeGroupForRole returns (customer) for customer; login(email,password). (7) CREATE src/i18n/ (i18next + ' +
    'react-i18next, en + ne bundles for the customer-facing strings, I18nProvider + useT hook + a setLanguage persisted to ' +
    'AsyncStorage) and src/theme/scale.tsx (FieldModeProvider + useScale hook returning a spacing/font multiplier, default ' +
    '1, large-touch 1.25, persisted to AsyncStorage). You OWN: app/_layout.tsx, app/index.tsx, app/(customer)/_layout.tsx, ' +
    'src/auth/AuthContext.tsx, src/i18n/**, src/theme/scale.tsx, and the folder delete/rename. Do NOT rewrite the ' +
    'individual screen bodies (M2/M3/M4 own those) beyond what the rename requires. Keep types from @teranode/types where ' +
    'useful. Self-check: npm run -w @teranode/mobile typecheck (fix errors in YOUR files; residual errors in screens owned ' +
    'by other units are acceptable).')
  await unit('5.M5 mobile api seam (client + mock)', 'P5 Mobile',
    'Rewrite apps/mobile/src/api/client.ts and src/api/mock.ts for the 2-role world. Keep the USE_MOCK seam reading ' +
    'app.json extra.useMockApi via expo-constants. Expose api.* methods matching the API surface 1:1 (read spec section 5): ' +
    'login(email,password) → {accessToken,user,...}; me(); farms(); zones(farmId); zone(zoneId); zoneAnalysis(zoneId) → ' +
    'ZoneAnalysis; assignZone(zoneId,{cropId,plantingDate,nodeId?,channels?}); crops(); deviceCatalog(); setZoneMode/ ' +
    'setValve via POST /actuators/:id/command; rules(zoneId); alerts()/ackAlert(id); harvest()/addHarvest(); ' +
    'analyticsUsage(farmId)/analyticsSavings(farmId); telemetry(zoneId,agg). The MOCK (src/api/mock.ts) must: seed 1 ' +
    'customer + 1 farm + 3 zones (tomato fruiting, capsicum flowering, spinach vegetative) with planting dates, run the ' +
    'driftZones live hysteresis on an interval (moisture rises when valve open, hysteresis low/high, pump follows), and ' +
    'compute zoneAnalysis by calling @teranode/agronomy analyzeZone so health/recommendations EXACTLY match the server. ' +
    'Seed mock crops from @teranode/agronomy. You OWN only these two files. Self-check: npm run -w @teranode/mobile typecheck.')
  await unit('5.M1 mobile shared components', 'P5 Mobile',
    'Build/refresh apps/mobile/src/components/**. Create HealthRing.tsx (a 0..100 health ring via react-native-svg, arc + ' +
    'centered score, color from score: >=80 healthy green, 50-79 amber, <50 critical red), CropPicker.tsx (a searchable, ' +
    'category-filterable crop list fed by api.crops(), each row emoji + en/ne name + days-to-harvest + a short climate-fit ' +
    'hint), Charts.tsx (a lightweight svg sparkline + bar chart for history/analytics). Extend the existing ui.tsx (make ' +
    'its <T> text component i18n-aware via useT and scale-aware via useScale) and FieldTiles.tsx (add the crop emoji + a ' +
    'growth-stage badge + a small HealthRing to each zone tile). Reuse the existing GaugeRing.tsx + BarMeter.tsx look. You ' +
    'OWN src/components/** (ui.tsx, FieldTiles.tsx, GaugeRing.tsx, BarMeter.tsx, HealthRing.tsx, CropPicker.tsx, ' +
    'Charts.tsx). Self-check: npm run -w @teranode/mobile typecheck.')
  return await parallel([
    () => unit('5.M2 dashboard + zone detail', 'P5 Mobile',
      'Overwrite app/(customer)/dashboard.tsx and app/(customer)/zones/[zoneId].tsx (these were moved here by M0). ' +
      'Dashboard (Field): live zone tiles (FieldTiles with HealthRing + crop emoji + stage badge) from api.zones/zone + ' +
      'api.zoneAnalysis, a systems strip (pump/dosing/reservoir) + weather, a savings tile, pull-to-refresh, and ' +
      'offline-cached last overview (AsyncStorage). Zone detail: GaugeRing (moisture) + BarMeters (ph/ec/n/p/k) with ' +
      'stage-aware target ticks taken from api.zoneAnalysis (idealRange per channel), per-channel below/in/above colored ' +
      'pills, a valve Auto/Manual segmented control + open/close with desired-vs-reported pending state (via ' +
      'api.setZoneMode/setValve), and a Coach card showing the top recommendation (localized via useT). Use api.* (never ' +
      'import the mock directly) + useT + useScale. Self-check: npm run -w @teranode/mobile typecheck.'),
    () => unit('5.M3 assign-zone + crop picker flow', 'P5 Mobile',
      'Create app/(customer)/zones/new.tsx: a guided wizard — step 1 pick a crop (use the CropPicker component) → step 2 ' +
      'set planting date → step 3 enter/confirm the ESP32 node + select sensor channels (moisture/ph/ec/n/p/k/soiltemp ' +
      'toggles) → submit via api.assignZone (auto-applies the crop-derived rule), then show the resulting ideal bands + ' +
      'a success state that links to the new zone detail. Localized + scale-aware. Self-check: npm run -w @teranode/mobile ' +
      'typecheck.'),
    () => unit('5.M4 analytics + alerts + history + account', 'P5 Mobile',
      'Overwrite app/(customer)/analytics.tsx, alerts.tsx, history.tsx, account.tsx. Analytics: water/fertilizer usage ' +
      'charts (Charts component) from api.analyticsUsage, a savings stat from api.analyticsSavings, a harvest/yield log ' +
      '(api.harvest/addHarvest) with an add form, and a CSV share (api.exportCsv or build/share text). Alerts: localized ' +
      'list (severity color) + acknowledge (api.ackAlert). History: rollup sparklines via api.telemetry(zoneId, "1h"/"1d") ' +
      'per channel with a zone + channel picker. Account: profile, a language toggle (en/ne) wired to setLanguage, and a ' +
      'Field-mode toggle wired to the FieldModeProvider, plus logout. Use api.* + useT + useScale. Self-check: ' +
      'npm run -w @teranode/mobile typecheck.'),
  ])
}

const [web, mobile] = await parallel([() => webTrack(), () => mobileTrack()])
return { phase: 'P5 Clients', web, mobile }
