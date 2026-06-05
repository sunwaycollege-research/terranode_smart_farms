export const meta = {
  name: 'teranode-build',
  description: 'Autonomously build the 2-role crop-driven TERANODE product: shared packages, full IoT backend (Postgres/Timescale/Redis/MQTT/Docker), MQTT ingest + virtual gateway, React web admin, and RN customer app — across 6 verified phases.',
  whenToUse: 'After Phase 0 monorepo reshape is done. Builds backend + web + mobile per docs/BUILD-SPEC.md.',
  phases: [
    { title: 'P1 Shared', detail: 'types + agronomy (14 crops + pure engine)' },
    { title: 'P1 Gate', detail: 'vitest + typecheck' },
    { title: 'P2 Backend base', detail: 'infra/docker + DB schema/migrate/seed + API skeleton/auth' },
    { title: 'P2 Gate', detail: 'docker up + migrate + seed + login (both roles)' },
    { title: 'P3 Routes', detail: '6 parallel feature route+service units' },
    { title: 'P3 Gate', detail: 'route smoke against live DB + typecheck' },
    { title: 'P4 Ingest/RT', detail: 'MQTT ingest + virtual gateway + WebSocket' },
    { title: 'P4 Gate', detail: 'telemetry round-trip + rollups' },
    { title: 'P5 Web', detail: 'Vite admin scaffold + 4 page units' },
    { title: 'P5 Mobile', detail: 'role trim + api seam + components + screens' },
    { title: 'P5 Gate', detail: 'vite build + expo export (Metro bundle)' },
    { title: 'P6 Cutover', detail: 'flip mock->real + end-to-end verify + RUN.md' },
  ],
}

// ---------------------------------------------------------------------------
const SPEC = 'docs/BUILD-SPEC.md'

const PRE =
  'You are one autonomous build agent in the TERANODE workflow. The repo root is your cwd ' +
  '(it is NOT a git repo). FIRST, read ' + SPEC + ' in full — it is the authoritative spec ' +
  '(2-role model, full Postgres/Timescale data model, the 14-crop library numbers, agronomy ' +
  'engine signatures + health formula, the API surface, client screen lists, and the precise ' +
  'file-ownership map in section 8). Also read any existing files relevant to your unit ' +
  '(e.g. apps/mobile/src/theme/tokens.ts for the palette, apps/api/src/db/* and routes/auth.ts ' +
  'for patterns, packages/types and packages/agronomy exports for the exact shared types). ' +
  'RULES: extensionless relative imports in packages/* and apps/api|ingest; do NOT run npm install ' +
  'or add new dependencies (everything needed is installed; hand-roll CSV); write ONLY the files your ' +
  'unit owns and never a file owned by another unit; write complete working code (no TODO placeholders ' +
  'in your owned files unless explicitly told to emit a stub). Before finishing, run the relevant ' +
  '"npm run -w <workspace> typecheck" (and test for agronomy) and FIX your own errors. Avoid foreground ' +
  '`sleep`; when you must wait, poll with a retry loop (curl --retry --retry-connrefused, or a repeated ' +
  'cheap command). Return ONLY the structured object your schema requires — your final text is data.'

const UNIT_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: {
    unit: { type: 'string' },
    filesWritten: { type: 'array', items: { type: 'string' } },
    summary: { type: 'string', description: 'what you built, 2-5 sentences' },
    selfCheck: {
      type: 'object', additionalProperties: false,
      properties: {
        command: { type: 'string' }, passed: { type: 'boolean' }, detail: { type: 'string' },
      }, required: ['command', 'passed', 'detail'],
    },
  }, required: ['unit', 'filesWritten', 'summary', 'selfCheck'],
}

const GATE_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: {
    phase: { type: 'string' },
    passed: { type: 'boolean' },
    checks: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false,
        properties: { name: { type: 'string' }, passed: { type: 'boolean' }, detail: { type: 'string' } },
        required: ['name', 'passed', 'detail'],
      },
    },
    repairsApplied: { type: 'array', items: { type: 'string' } },
    remaining: { type: 'array', items: { type: 'string' } },
  }, required: ['phase', 'passed', 'checks', 'repairsApplied', 'remaining'],
}

const unit = (label, phase, instructions) =>
  agent(PRE + '\n\n## YOUR UNIT: ' + label + '\n' + instructions, { label, phase, schema: UNIT_SCHEMA })

const gate = (label, phase, instructions) =>
  agent(
    PRE + '\n\n## VERIFICATION GATE: ' + label +
      '\nYou MUST actually run the checks with Bash and REPAIR failures by editing the relevant ' +
      'owned source files, then re-run until green or until you have a clear remaining list. Be honest ' +
      'about what passes. ' + instructions,
    { label, phase, schema: GATE_SCHEMA },
  )

// ===========================================================================
// PHASE 1 — shared packages (types first, then agronomy depends on it)
// ===========================================================================
log('P1: building shared packages (types -> agronomy)')
const u_types = await unit('1.1 @teranode/types', 'P1 Shared',
  'Implement packages/types/src/** as the canonical shared type home. Define: enums (AccountType admin|customer, ' +
  'UserRole admin|customer, account status, channel types, alert severity, actuator scope/type, gateway status); ' +
  'entity interfaces matching the DB (Account, User, Crop-ref, Farm, Gateway, Node, Zone, SensorChannel, Rule, ' +
  'Schedule, DosingProfile, Actuator, Alert, HarvestLog, EntitlementRecord, DeviceCatalogItem, AuditEntry); the ' +
  'crop+agronomy data and result types (Crop, CropBand, CropStageDef, GrowthStage, CropCategory, Channel, Range, ' +
  'BandStatus, ChannelStatus, HealthResult, Recommendation, ZoneAnalysis) so BOTH @teranode/agronomy and the ' +
  'clients import them from here; request/response DTOs for every endpoint in spec section 5; and WS message types. ' +
  'Re-export everything from src/index.ts. Keep it dependency-free. Self-check: npm run -w @teranode/types typecheck.')

const u_agro = await unit('1.2 @teranode/agronomy', 'P1 Shared',
  'Implement packages/agronomy/src/**. crops/: build ALL 14 crops from spec section 3 (tomato, capsicum, chili, ' +
  'cucumber, spinach, lettuce, cabbage, cauliflower, onion, carrot, potato, eggplant, okra, beans) each with a full ' +
  'stages[] timeline (germination/vegetative/flowering/fruiting/harvest as appropriate; leafy/root skip flowering/' +
  'fruiting), ideal + wider acceptable bands, using the 4 fully-specified patterns as templates and the table for the ' +
  'rest. engine/: stage.ts (currentStage), status.ts (evaluateChannels), health.ts (zoneHealth with the exact ' +
  'weighted formula in spec section 4), recommend.ts (recommendations en+ne), rules.ts (deriveRule), and analyzeZone. ' +
  'Import shared types from @teranode/types (do not redefine them). Export all from src/index.ts. Add thorough vitest ' +
  'tests (src/**/*.test.ts) covering stage derivation, banding (below/in/above + boundaries), health score bounds ' +
  '(0..100, in-band=100, missing channels), recommendations, deriveRule, and analyzeZone end-to-end for tomato. ' +
  'Self-check: npm run -w @teranode/agronomy test AND npm run -w @teranode/agronomy typecheck.')

const g1 = await gate('P1 gate', 'P1 Gate',
  'Run, in the repo root: npm run -w @teranode/types typecheck ; npm run -w @teranode/agronomy typecheck ; ' +
  'npm run -w @teranode/agronomy test. Fix any failures by editing packages/types or packages/agronomy. ' +
  'Confirm >=12 crops exported and that analyzeZone returns an integer health 0..100 with recommendations.')

// ===========================================================================
// PHASE 2 — infra + DB + API skeleton/auth
// ===========================================================================
log('P2: infra + DB schema/seed (parallel) -> API skeleton + auth')
const [u_infra, u_db] = await parallel([
  () => unit('2.1 infra/docker', 'P2 Backend base',
    'Create infra/docker-compose.yml with services: timescaledb (image timescale/timescaledb:latest-pg16, env ' +
    'POSTGRES_USER/PASSWORD/DB from root .env, port 5432:5432, named volume, healthcheck using pg_isready), ' +
    'redis (redis:7-alpine, 6379:6379), mosquitto (eclipse-mosquitto:2, 1883:1883 + 9001:9001, mount ' +
    'infra/mosquitto/mosquitto.conf which allows anonymous + listener 1883 + listener 9001 protocol websockets, ' +
    'for dev), and nginx (nginx:alpine, 8080:80, mount infra/nginx/nginx.conf reverse-proxying /api to the api ' +
    'host and serving a placeholder). Provide infra/mosquitto/mosquitto.conf and infra/nginx/nginx.conf. Ensure ' +
    '"docker compose -f infra/docker-compose.yml config" is valid (run it as your self-check; do NOT need to pull ' +
    'images here — the P2 gate brings the stack up).'),
  () => unit('2.2 DB schema/migrate/seed', 'P2 Backend base',
    'Implement apps/api/src/db/: schema.ts (drizzle-orm/pg-core schema for every table in spec section 2, exact ' +
    'column names/types), client.ts (drizzle client over a pg Pool from DATABASE_URL), migrate.ts (connect with pg ' +
    'and execute idempotent raw SQL for ALL extensions/enums/tables/indexes/hypertables/continuous-aggregates/' +
    'policies in spec section 2 — guard enums with a DO $$ BEGIN ... EXCEPTION WHEN duplicate_object THEN null; END $$ ' +
    'pattern, use IF NOT EXISTS where possible, and create continuous aggregates WITH NO DATA then add refresh ' +
    'policies; tolerate re-runs), and seed.ts (insert the full parity seed in spec section 2: admin root + admin user ' +
    'admin@teranode.io and customer Green Valley Farm + user farmer@greenvalley.np, both bcryptjs hash of "teranode"; ' +
    'farm; esp32 gateway TN-ESP32-0001 online; 3 zones tomato/capsicum/spinach with planting_date offsets giving ' +
    'fruiting/flowering/vegetative stages; sensor_channels per zone + farm weather channels; rules derived from each ' +
    "crop's current stage via @teranode/agronomy deriveRule; entitlement_records for the customer; device_catalog 9 " +
    'modules; ALL 14 crops + crop_stages by importing @teranode/agronomy crop seed). Also create infra/drizzle.config.ts. ' +
    'Use computed timestamps from the DB (now()) — do not call Date.now in seed if avoidable, or compute planting ' +
    'dates with SQL interval. Self-check: npm run -w @teranode/api typecheck.'),
])

const u_apiskel = await unit('2.3 API skeleton + auth', 'P2 Backend base',
  'Rewrite apps/api/src/index.ts: build the Express app (cors from CORS_ORIGIN, express.json), create an http.Server, ' +
  'GET /healthz, mount the REAL authRouter at /auth, mount STUB routers at /admin,/farms,/zones,/actuators,/rules,' +
  '/alerts,/harvest,/crops,/analytics and /device-catalog, call attachWebsocket(server) imported from ./ws, add 404 + ' +
  'error handlers, and server.listen(PORT). Create apps/api/src/middleware/auth.ts (requireAuth verifying the access ' +
  'JWT and attaching {userId,accountId,accountType,role}; requireAdmin; scopeToCustomer) and middleware/error.ts. ' +
  'Create apps/api/src/lib/jwt.ts (sign/verify access+refresh) and lib/redis.ts (ioredis client; store/rotate refresh ' +
  'tokens). Implement REAL apps/api/src/routes/auth.ts: POST /login (look up user by email, bcryptjs.compare password, ' +
  'issue access+refresh, store refresh in redis), POST /refresh (rotate), POST /logout, GET /me, GET /me/entitlements. ' +
  'Create apps/api/src/ws/index.ts exporting attachWebsocket(server) as a minimal stub (sets up a ws server on path ' +
  '/live and accepts connections; real fan-out is filled in Phase 4) — it MUST compile and not crash. Create STUB ' +
  'route files apps/api/src/routes/{admin,farms,zones,actuators,rules,alerts,harvest,crops,analytics}.ts each exporting ' +
  'an express Router that responds 501 (do NOT import any services/* — those are filled in Phase 3) plus a ' +
  'deviceCatalogRouter for /device-catalog (can be real: SELECT * FROM device_catalog). DELETE legacy files that no ' +
  'longer fit: apps/api/src/store.ts, apps/api/src/types.ts, and any legacy route files (retailer.ts, plus old ' +
  'farms/zones/actuators/alerts/admin route bodies — overwrite them with the new stubs). Import shared types from ' +
  '@teranode/types and the db client/schema from ./db (created by unit 2.2). Self-check: npm run -w @teranode/api typecheck.')

const g2 = await gate('P2 gate', 'P2 Gate',
  'Bring up the full stack and prove auth works. Steps: (1) docker compose -f infra/docker-compose.yml up -d — use a ' +
  'LONG Bash timeout (e.g. 600000 ms) because first-run image pulls (timescaledb/redis/mosquitto/nginx) take minutes; ' +
  'if a pull stalls, retry once. (2) Wait for Postgres by polling: docker compose -f infra/docker-compose.yml exec -T ' +
  'timescaledb pg_isready -U teranode (loop ~30 tries, no foreground sleep). (3) npm run -w @teranode/api migrate then ' +
  'npm run -w @teranode/api seed. (4) Boot the api in background: (npm run -w @teranode/api start > /tmp/tn-api.log 2>&1 &) ; ' +
  'then curl --retry 30 --retry-delay 1 --retry-connrefused http://localhost:4000/healthz. (5) POST /auth/login for ' +
  'admin@teranode.io and farmer@greenvalley.np (password teranode) — BOTH must return an access token. Kill the bg api ' +
  'when done (pkill -f "tsx src/index.ts"). Repair migrate/seed/auth/schema errors by editing apps/api/src/db/* , ' +
  'routes/auth.ts, middleware/*, or lib/*. Leave docker running for later phases. Report each check.')

// ===========================================================================
// PHASE 3 — backend feature routes (6 parallel, disjoint route+service files)
// ===========================================================================
log('P3: 6 parallel feature route units')
const p3 = await parallel([
  () => unit('3.1 admin/customers/entitlements/audit', 'P3 Routes',
    'Implement apps/api/src/routes/admin.ts (overwrite the stub) + apps/api/src/services/{customers,entitlements,audit}.ts. ' +
    'Endpoints (requireAdmin): GET/POST /admin/customers (create = new customer account under the admin root + an owner ' +
    'user with bcryptjs hash + default entitlement_records), GET/PATCH /admin/customers/:id, PATCH /admin/customers/:id/' +
    'entitlements (always allowed), GET /admin/fleet (all gateways + status/last_seen), POST /admin/gateways (register ' +
    'serial -> create gateway unbound + device_token), POST /admin/gateways/:id/bind (attach to a farm), POST ' +
    '/admin/gateways/:id/ota (record fw target), GET /admin/audit. Write an audit_log row for every mutation. Use the db ' +
    'client + middleware from Phase 2. Self-check: npm run -w @teranode/api typecheck.'),
  () => unit('3.2 farms/zones/assign/analysis/telemetry', 'P3 Routes',
    'Implement apps/api/src/routes/farms.ts + routes/zones.ts (overwrite stubs) + services/{farms,zones}.ts. farms: ' +
    'GET/POST /farms (customer-scoped via scopeToCustomer), GET/PATCH/DELETE /farms/:id, GET /farms/:id/zones. zones: ' +
    'POST /zones, PATCH/DELETE /zones/:id, POST /zones/:id/assign (body {cropId, plantingDate, nodeId?, channels?[]}: set ' +
    'zone.crop_id+planting_date+node_id, create sensor_channels, then call @teranode/agronomy currentStage+deriveRule and ' +
    'upsert the rules row with source=crop), GET /zones/:id/analysis (load zone+crop+stages+latest channel readings, call ' +
    'agronomy analyzeZone, return ZoneAnalysis), GET /zones/:id/telemetry?from&to&agg=raw|5m|1h|1d (query telemetry for raw ' +
    'or telemetry_5m/1h/1d for rollups). Self-check: npm run -w @teranode/api typecheck.'),
  () => unit('3.3 actuators/rules/schedules/dosing', 'P3 Routes',
    'Implement apps/api/src/routes/actuators.ts + routes/rules.ts (overwrite stubs) + services/control.ts. POST ' +
    '/actuators/:id/command {action: open|close|on|off|dose}: set actuator.desired and (for now, pre-MQTT) also set ' +
    'state, returning desired-vs-reported — do NOT import a not-yet-existing mqtt publisher; just update the DB (Phase 4 ' +
    'wires real MQTT). GET/PUT /zones/:id/rules (PUT sets source=manual). GET /farms/:id/schedules, PUT /schedules/:id ' +
    '(window hours, et0_aware, max_run_min). GET/PUT /farms/:id/dosing-profile. All customer-scoped. Self-check: ' +
    'npm run -w @teranode/api typecheck.'),
  () => unit('3.4 alerts/harvest', 'P3 Routes',
    'Implement apps/api/src/routes/alerts.ts + routes/harvest.ts (overwrite stubs) + services/alerts.ts. GET /alerts ' +
    '(customer-scoped, newest first, localized message_en/ne), POST /alerts/:id/ack (set acknowledged_at). GET/POST ' +
    '/harvest (harvest_log entries for the customer farms; POST records zone_id, crop_id, harvested_at, yield_kg, notes). ' +
    'Self-check: npm run -w @teranode/api typecheck.'),
  () => unit('3.5 crops catalog', 'P3 Routes',
    'Implement apps/api/src/routes/crops.ts + services/crops.ts (overwrite stub). GET /crops and GET /crops/:id (any ' +
    'authenticated user) returning crops joined with their crop_stages from the DB; POST /crops, PATCH /crops/:id, PATCH ' +
    '/crops/:id/stages (requireAdmin). Shapes per @teranode/types Crop. Self-check: npm run -w @teranode/api typecheck.'),
  () => unit('3.6 analytics/export', 'P3 Routes',
    'Implement apps/api/src/routes/analytics.ts + services/analytics.ts (overwrite stub). GET /analytics/usage?farmId&' +
    'from&to&agg (query usage_1d continuous aggregate for water_liters/dose_ml totals), GET /analytics/savings?farmId&from' +
    '&to (estimate savings vs a flood-irrigation baseline: baseline_liters - actual; return liters + percent), GET ' +
    '/analytics/export?farmId&from&to&format=csv (hand-roll CSV text with a proper content-type + filename header). ' +
    'Customer-scoped. Self-check: npm run -w @teranode/api typecheck.'),
])

const g3 = await gate('P3 gate', 'P3 Gate',
  'Ensure docker is up and the api is migrated+seeded (re-run migrate/seed if needed). Boot the api in background, then ' +
  'acquire an ADMIN token and a CUSTOMER token via POST /auth/login. With the right token, curl: GET /crops (expect >=12), ' +
  'GET /device-catalog, GET /admin/customers, GET /admin/fleet, GET /farms (customer), then take a seeded zone id and GET ' +
  '/zones/:id/analysis (expect health 0..100 + recommendations) and GET /zones/:id/telemetry?agg=raw, GET /alerts, GET ' +
  '/harvest, GET /analytics/usage. Any 404-route or 500 must be repaired by editing the offending routes/* or services/*. ' +
  'Finish with npm run -w @teranode/api typecheck. Kill the bg api. Report per-route pass/fail.')

// ===========================================================================
// PHASE 4 — ingest worker + virtual gateway + WebSocket realtime (parallel)
// ===========================================================================
log('P4: ingest + virtual gateway + websocket')
const p4 = await parallel([
  () => unit('4.1 MQTT ingest worker', 'P4 Ingest/RT',
    'Implement apps/ingest/src/index.ts + src/handlers/*.ts + src/db.ts. Connect to MQTT (MQTT_URL), pg (DATABASE_URL), ' +
    'and redis (REDIS_URL). Subscribe to teranode/+/+/+/telemetry/zone/+ , /telemetry/weather , /telemetry/gateway/health , ' +
    'and state/# . On telemetry: parse the payload (shape per spec: moisture/ph/ec/n/p/k/soiltemp/airTemp/humidity/rain/' +
    'valve/pump/dosing), insert one telemetry row per channel (resolve channel_id from zone_id+type), insert usage_events ' +
    '(water_liters while valve open) and update actuators.state, then publish a normalized JSON update to a redis channel ' +
    'like live:farm:{farmId} and live:zone:{zoneId}. Detect gateway offline via LWT/health gaps and insert an alert. ' +
    'Self-check: npm run -w @teranode/ingest typecheck.'),
  () => unit('4.2 virtual gateway publisher', 'P4 Ingest/RT',
    'Implement apps/ingest/src/virtual/index.ts (+ helpers). On an interval (SIM_TICK_MS), replay the legacy driftZones ' +
    'hysteresis (read the old logic from the backup if helpful: moisture rises ~+1.2 when valve open else ~-0.5; in auto ' +
    'mode open valve when moisture<rule.moisture_low and close when >moisture_high; pump on if any valve open; jitter ' +
    'ph/ec/soilTemp; accumulate water liters while a valve is open) and PUBLISH telemetry over MQTT to ' +
    'teranode/{accountId}/{farmId}/{gatewayId}/telemetry/zone/{zoneId} for the seeded farm. Load the farm/zones/rules/ids ' +
    'from the DB at startup. Provide the npm script target (already named "virtual" in package.json -> src/virtual/index.ts). ' +
    'Self-check: npm run -w @teranode/ingest typecheck.'),
  () => unit('4.3 WebSocket + command publish', 'P4 Ingest/RT',
    'Implement apps/api/src/ws/index.ts (replace the Phase-2 stub): attachWebsocket(server) starts a ws server on path ' +
    '/live, authenticates the connection via ?token=JWT (verify with lib/jwt), accepts {subscribe: farmId|zoneId} messages, ' +
    'subscribes to the matching redis channels (live:farm:* / live:zone:*) via an ioredis subscriber, and forwards messages ' +
    'to the socket scoped to the connection account. Also implement apps/api/src/lib/mqttPublish.ts (connect to MQTT_URL; ' +
    'export publishCommand(topic,payload) and publishRetainedConfig). Do NOT modify apps/api/src/index.ts (it already calls ' +
    'attachWebsocket). You MAY have routes/actuators.ts (owned by 3.3) call publishCommand — but to respect ownership, only ' +
    'ADD lib/mqttPublish.ts here and leave wiring optional; note it in your summary. Self-check: npm run -w @teranode/api typecheck.'),
])

const g4 = await gate('P4 gate', 'P4 Gate',
  'Prove the hardware-free telemetry round-trip. Ensure docker up + api migrated/seeded. Start the ingest worker in ' +
  'background: (npm run -w @teranode/ingest start > /tmp/tn-ingest.log 2>&1 &) and the virtual gateway: ' +
  '(npm run -w @teranode/ingest virtual > /tmp/tn-virtual.log 2>&1 &). Poll (no foreground sleep — repeat the query in a ' +
  'loop) the DB for telemetry rows: docker compose -f infra/docker-compose.yml exec -T timescaledb psql -U teranode -d ' +
  'teranode -tAc "select count(*) from telemetry" until > 0 (≈30 tries). Then refresh the 5m aggregate: ... psql -c ' +
  '"CALL refresh_continuous_aggregate(\'telemetry_5m\', NULL, NULL)". Boot the api and GET /zones/:id/telemetry?agg=5m ' +
  'and confirm rows. If time permits, connect a quick ws client to ws://localhost:4000/live?token=<customer JWT>, send a ' +
  'subscribe, and confirm a live message arrives. Repair handlers/virtual/ws code as needed. Kill bg procs. Report which ' +
  'parts of the round-trip (publish, ingest->DB, rollup, WS) work.')

// ===========================================================================
// PHASE 5 — clients: web admin track + mobile customer track (parallel tracks)
// ===========================================================================
log('P5: web admin + RN mobile (parallel tracks)')

async function webTrack() {
  const w0 = await unit('5.W0 web scaffold', 'P5 Web',
    'Scaffold apps/web (Vite + React 18 + TS, admin role only). Create: vite.config.ts (@vitejs/plugin-react, define ' +
    'VITE_API_URL default http://localhost:4000), index.html, src/main.tsx, src/App.tsx, src/router.tsx (react-router-dom v6 ' +
    'routes: /login + protected admin shell with nav to Customers/Fleet/Crops/Audit/Analytics), src/api/client.ts (typed ' +
    'fetch wrapper using @teranode/types DTOs, base from import.meta.env.VITE_API_URL, JWT in localStorage, login/refresh), ' +
    'src/i18n/** (i18next en+ne + provider), src/theme/** (CSS variables porting the parchment+soil palette from ' +
    'apps/mobile/src/theme/tokens.ts; a tokens.css + ThemeProvider), and src/components/** (Button, Card, Table, Toggle, ' +
    'Field, Nav). Create MINIMAL placeholder pages src/pages/{customers,fleet,crops,audit,analytics}/index.tsx (a heading) ' +
    'so the router resolves — units W1-W4 will overwrite these. Add a typecheck script to apps/web/package.json. Self-check: ' +
    'npm run -w @teranode/web build (vite) must succeed.')
  return await parallel([
    () => unit('5.W1 customers', 'P5 Web',
      'Overwrite apps/web/src/pages/customers/**: a Customers list (search/status), a Create-customer wizard (name + owner ' +
      'email/password + device-catalog module toggles/steppers from GET /device-catalog, freely editable, no lock), and a ' +
      'Customer detail page with a freely-editable entitlement editor (PATCH /admin/customers/:id/entitlements). Use ' +
      'src/api/client + i18n + components. Self-check: npm run -w @teranode/web build.'),
    () => unit('5.W2 fleet', 'P5 Web',
      'Overwrite apps/web/src/pages/fleet/**: gateway list with online/offline/last-seen/battery/fw (GET /admin/fleet), a ' +
      'Register-gateway form (serial -> token, POST /admin/gateways), Bind-to-farm action (POST /admin/gateways/:id/bind), ' +
      'and an OTA panel (POST /admin/gateways/:id/ota). Self-check: npm run -w @teranode/web build.'),
    () => unit('5.W3 crops admin', 'P5 Web',
      'Overwrite apps/web/src/pages/crops/**: a crop-library table (GET /crops) showing ideal bands + stages, and an ' +
      'add/edit crop & stages editor (POST/PATCH /crops). Self-check: npm run -w @teranode/web build.'),
    () => unit('5.W4 audit/analytics', 'P5 Web',
      'Overwrite apps/web/src/pages/{audit,analytics}/**: an audit-log viewer (GET /admin/audit) and an analytics dashboard ' +
      'with recharts (usage/savings via GET /analytics/usage + /analytics/savings, with a farm picker). Self-check: ' +
      'npm run -w @teranode/web build.'),
  ])
}

async function mobileTrack() {
  const m0 = await unit('5.M0 mobile role trim + providers', 'P5 Mobile',
    'Refactor the mobile app to 2 roles, keeping it on the mock. (1) Delete app/(company)/ and app/(retailer)/ entirely. ' +
    '(2) Rename app/(farmer)/ to app/(customer)/ (move every file, including _layout.tsx, dashboard.tsx, history.tsx, ' +
    'alerts.tsx, account.tsx, zones/[zoneId].tsx). (3) Rewrite app/_layout.tsx to declare only (auth) + (customer) groups ' +
    'and to wrap the tree in your new I18nProvider and FieldModeProvider. (4) Rewrite app/index.tsx for a 2-role redirect ' +
    '(customer -> /(customer)/dashboard; admin -> a simple in-app notice that admin uses the web console). (5) Update ' +
    'src/auth/AuthContext.tsx: homeGroupForRole maps admin|customer; login(email,password). (6) Create src/i18n/** ' +
    '(i18next en+ne + I18nProvider + a useT hook + language toggle setter persisted to AsyncStorage) and ' +
    'src/theme/scale.tsx (FieldModeProvider + useScale that bumps spacing/font sizes for large-touch field mode, persisted). ' +
    'Keep app on mock (useMockApi stays true). You OWN: app/_layout.tsx, app/index.tsx, app/(customer)/_layout.tsx, ' +
    'src/auth/AuthContext.tsx, src/i18n/**, src/theme/scale.tsx, and the group delete/rename. Leave the individual screen ' +
    'bodies for later units (they will be overwritten). Self-check: npm run -w @teranode/mobile typecheck (fix errors in ' +
    'the files YOU own; residual errors in screen files owned by M2/M4 are acceptable for now).')
  const m5 = await unit('5.M5 api seam (client+mock)', 'P5 Mobile',
    'Update apps/mobile/src/api/client.ts and src/api/mock.ts. Keep the USE_MOCK seam reading app.json extra.useMockApi. ' +
    'Add/refresh methods to match the API surface 1:1: login(email,password), me, overview/farm, zone, zoneAnalysis(zoneId), ' +
    'assignZone(...), crops(), setZoneMode, setValve (actuator command), rules, alerts/ackAlert, harvest(list/add), ' +
    'analyticsUsage/analyticsSavings, exportCsv. The mock must keep the driftZones live sim AND reuse @teranode/agronomy ' +
    'analyzeZone so health/recommendations match the server; seed mock crops from @teranode/agronomy and 3 zones with ' +
    'planting dates. You OWN only these two files. Self-check: npm run -w @teranode/mobile typecheck (your files).')
  const m1 = await unit('5.M1 shared components', 'P5 Mobile',
    'Build/refresh apps/mobile/src/components/**: HealthRing.tsx (0..100 conic/arc ring using react-native-svg, color by ' +
    'score), CropPicker.tsx (searchable list with category filter + climate-fit hint, fed by api.crops()), Charts.tsx ' +
    '(simple svg sparkline/bar for history & analytics), and extend ui.tsx (i18n-aware text + scale-aware spacing via ' +
    'useScale/useT) and FieldTiles.tsx (add crop emoji + stage badge + a small health ring to each zone tile). Reuse ' +
    'GaugeRing/BarMeter. You OWN src/components/**. Self-check: npm run -w @teranode/mobile typecheck.')
  const screens = await parallel([
    () => unit('5.M2 dashboard + zone detail', 'P5 Mobile',
      'Overwrite app/(customer)/dashboard.tsx and app/(customer)/zones/[zoneId].tsx. Dashboard: live zone tiles (FieldTiles ' +
      'with HealthRing + crop emoji/stage badge), systems + weather, a savings tile, pull-to-refresh, offline-cached last ' +
      'overview (AsyncStorage). Zone detail: GaugeRing (moisture) + BarMeters (ph/ec/n/p/k) with stage-aware target ticks ' +
      'from api.zoneAnalysis, per-channel below/in/above pills, valve auto/manual control with desired-vs-reported pending ' +
      'state, and a Coach card showing the top recommendation (localized). Use api.* (not the mock directly) + useT/useScale. ' +
      'Self-check: npm run -w @teranode/mobile typecheck.'),
    () => unit('5.M3 assign-zone + crop picker flow', 'P5 Mobile',
      'Create app/(customer)/zones/new.tsx: a guided wizard — pick a crop (CropPicker) -> set planting date -> enter/confirm ' +
      'the ESP32 node + sensor channels -> submit via api.assignZone which auto-applies the crop rule. Show the resulting ' +
      'ideal bands. Localized + scale-aware. Self-check: npm run -w @teranode/mobile typecheck.'),
    () => unit('5.M4 analytics + alerts + history + account', 'P5 Mobile',
      'Overwrite app/(customer)/analytics.tsx (usage/savings charts + harvest/yield log entry + CSV share via api), ' +
      'alerts.tsx (localized list + acknowledge), history.tsx (rollup sparklines via api telemetry agg), and account.tsx ' +
      '(profile + language toggle en/ne + Field mode toggle, using the providers from M0). Use api.* + useT/useScale. ' +
      'Self-check: npm run -w @teranode/mobile typecheck.'),
  ])
  return { m0, m5, m1, screens }
}

const [web, mobile] = await parallel([() => webTrack(), () => mobileTrack()])

const g5 = await gate('P5 gate', 'P5 Gate',
  'Build both clients. (1) npm run -w @teranode/web build (vite) must exit 0 — repair web build breaks in the owned ' +
  'files. (2) cd apps/mobile && npx expo export --platform web --output-dir /tmp/tn-mobile-export must exit 0 (Metro ' +
  'bundle) — repair resolution/syntax breaks. (3) npm run -w @teranode/web typecheck and npm run -w @teranode/mobile ' +
  'typecheck — fix build-breaking type errors; list any remaining non-fatal warnings. Report build status for web and mobile.')

// ===========================================================================
// PHASE 6 — cutover + end-to-end verification
// ===========================================================================
log('P6: cutover + end-to-end verification')
const u_cut = await unit('6.1 cutover', 'P6 Cutover',
  'Wire the clients to the live backend WITHOUT breaking the mock seam. (1) In apps/mobile/app.json set extra.useMockApi ' +
  'to false and extra.apiBaseUrl to http://localhost:4000 (the USE_MOCK code path must remain intact so it can be flipped ' +
  'back). (2) Confirm apps/web reads VITE_API_URL (default http://localhost:4000). (3) Verify the mobile api client ' +
  'method->endpoint map matches spec section 5 exactly; fix mismatches in src/api/client.ts only. You OWN apps/mobile/' +
  'app.json and may touch apps/mobile/src/api/client.ts only if an endpoint path is wrong. Self-check: ' +
  'npm run -w @teranode/mobile typecheck.')

const g6 = await gate('P6 gate', 'P6 Cutover',
  'Final end-to-end. Ensure: docker up; api migrated+seeded+running (bg); ingest worker + virtual gateway running (bg); ' +
  'web build OK. Acquire a CUSTOMER token and exercise GET /farms, GET /zones/:id/analysis, GET /alerts, GET ' +
  '/analytics/usage. Acquire an ADMIN token and exercise GET /admin/customers, GET /admin/fleet, GET /crops, GET ' +
  '/device-catalog. Confirm /zones/:id/telemetry?agg=5m returns rows (the virtual gateway should be feeding data). ' +
  'Write a RUN.md at the repo root documenting how to start everything end-to-end (infra up, migrate, seed, api, ingest ' +
  'worker, virtual gateway, web, mobile, plus the demo logins). Kill bg procs at the end. Report end-to-end pass/fail per flow.')

// ---------------------------------------------------------------------------
return {
  phase0: 'done inline (monorepo reshape verified)',
  p1: { types: u_types, agronomy: u_agro, gate: g1 },
  p2: { infra: u_infra, db: u_db, apiSkeleton: u_apiskel, gate: g2 },
  p3: { routes: p3, gate: g3 },
  p4: { realtime: p4, gate: g4 },
  p5: { web, mobile, gate: g5 },
  p6: { cutover: u_cut, gate: g6 },
}
