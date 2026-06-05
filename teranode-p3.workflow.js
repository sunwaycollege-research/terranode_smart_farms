export const meta = {
  name: 'teranode-p3-routes',
  description: 'Phase 3 — implement the 6 backend feature route+service units for TERANODE (admin, farms/zones/assign/analysis/telemetry, actuators/rules/schedules/dosing, alerts/harvest, crops, analytics). Build-only; verification is done inline by the operator.',
  phases: [{ title: 'P3 Routes', detail: '6 parallel feature route+service units' }],
}

const SPEC = 'docs/BUILD-SPEC.md'
const PRE =
  'You are one autonomous build agent for TERANODE. The repo root is your cwd (NOT a git repo). FIRST read ' + SPEC +
  ' fully (authoritative spec: 2-role model, full data model, crop library, agronomy engine, API surface in section 5, ' +
  'and the file-ownership map in section 8). Phases 1-2 are DONE and on disk: packages/types and packages/agronomy are ' +
  'implemented and tested; apps/api already has src/index.ts (mounts auth + STUB 501 routers for admin/farms/zones/' +
  'actuators/rules/alerts/harvest/crops/analytics + a real deviceCatalog router + calls attachWebsocket), src/db/' +
  '{schema,client,migrate,seed}.ts, src/lib/{jwt,redis}.ts, src/middleware/{auth,error}.ts, and a real src/routes/auth.ts. ' +
  'READ those files first to match the established patterns (how requireAuth/requireAdmin/scopeToCustomer attach ' +
  '{userId,accountId,accountType,role}; how db + schema are imported from ./db/client; how zod is used; response shapes ' +
  'from @teranode/types). The DB is live and seeded (1 admin, 1 customer Green Valley Farm, 1 farm, 1 gateway, 3 zones ' +
  'tomato/capsicum/spinach with planting dates + rules + sensor_channels, 14 crops, 9 device_catalog modules). ' +
  'RULES: extensionless relative imports; do NOT run npm install or add deps (hand-roll CSV); write ONLY the files your ' +
  'unit owns (one route file + its service file[s]); do NOT touch apps/api/src/index.ts (it already mounts your router by ' +
  'name — just OVERWRITE the matching stub route file so the export name stays identical to what index.ts imports — read ' +
  'index.ts to confirm the exact export name and path); write complete working code. Use the agronomy package via ' +
  "import from '@teranode/agronomy'. Before finishing, run: npm run -w @teranode/api typecheck and FIX your own errors. " +
  'Return ONLY the structured object your schema requires.'

const UNIT_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: {
    unit: { type: 'string' },
    filesWritten: { type: 'array', items: { type: 'string' } },
    endpoints: { type: 'array', items: { type: 'string' } },
    summary: { type: 'string' },
    selfCheck: {
      type: 'object', additionalProperties: false,
      properties: { command: { type: 'string' }, passed: { type: 'boolean' }, detail: { type: 'string' } },
      required: ['command', 'passed', 'detail'],
    },
  }, required: ['unit', 'filesWritten', 'endpoints', 'summary', 'selfCheck'],
}

const unit = (label, instructions) =>
  agent(PRE + '\n\n## YOUR UNIT: ' + label + '\n' + instructions, { label, phase: 'P3 Routes', schema: UNIT_SCHEMA })

const results = await parallel([
  () => unit('3.1 admin/customers/entitlements/audit',
    'Implement apps/api/src/routes/admin.ts (overwrite the stub; keep the export name index.ts imports) + ' +
    'apps/api/src/services/{customers,entitlements,audit}.ts. requireAdmin on all. Endpoints (spec section 5 admin block): ' +
    'GET/POST /admin/customers (create = new customer account whose parent is the admin root + an owner user with a ' +
    'bcryptjs password hash + a default entitlement_records row), GET/PATCH /admin/customers/:id (rename/enable/disable), ' +
    'PATCH /admin/customers/:id/entitlements (ALWAYS allowed — no lock), GET /admin/fleet (all gateways with status/' +
    'last_seen/fw + bound farm/customer), POST /admin/gateways (register serial -> create unbound gateway + a device_token ' +
    'row with a hashed secret), POST /admin/gateways/:id/bind (attach to a farm + set account_id + status), POST ' +
    '/admin/gateways/:id/ota (record an fw target / log), GET /admin/audit (recent audit_log). Write an audit_log row for ' +
    'every mutation. Self-check: npm run -w @teranode/api typecheck.'),
  () => unit('3.2 farms/zones/assign/analysis/telemetry',
    'Implement apps/api/src/routes/farms.ts + routes/zones.ts (overwrite the stubs, keep export names) + services/' +
    '{farms,zones}.ts. All customer-scoped via scopeToCustomer (admin may pass/act across, customers only own account). ' +
    'farms: GET/POST /farms, GET/PATCH/DELETE /farms/:id, GET /farms/:id/zones. zones: POST /zones, PATCH/DELETE /zones/:id, ' +
    'POST /zones/:id/assign (body {cropId, plantingDate, nodeId?, channels?}: set zones.crop_id+planting_date+node_id, ' +
    'create sensor_channels for the listed channels, then call @teranode/agronomy currentStage + deriveRule and UPSERT the ' +
    'rules row with source=crop + applied_stage), GET /zones/:id/analysis (load the zone + its crop + crop_stages + the ' +
    'latest reading per channel from telemetry, build a ChannelReadings map, call agronomy analyzeZone, return the ' +
    'ZoneAnalysis: stage, daysSincePlanting, health 0..100, channels, recommendations, rule), GET /zones/:id/telemetry?' +
    'from&to&agg=raw|5m|1h|1d (raw → telemetry table; 5m/1h/1d → telemetry_5m/1h/1d continuous aggregates; return time-series ' +
    'rows grouped by channel). Self-check: npm run -w @teranode/api typecheck.'),
  () => unit('3.3 actuators/rules/schedules/dosing',
    'Implement apps/api/src/routes/actuators.ts + routes/rules.ts (overwrite stubs, keep export names) + services/control.ts. ' +
    'POST /actuators/:id/command {action: open|close|on|off|dose}: set actuators.desired and (pre-MQTT, since the publisher ' +
    'lands in Phase 4) also set actuators.state, returning {desired, reported} — do NOT import a not-yet-existing mqtt ' +
    'module; just update the DB. GET/PUT /zones/:id/rules (PUT sets source=manual + updates moisture_low/high, ph/ec target). ' +
    'GET /farms/:id/schedules + PUT /schedules/:id (window_start/end_hour, et0_aware, max_run_min, enabled). GET/PUT ' +
    '/farms/:id/dosing-profile. Customer-scoped. If routes/rules.ts and routes/zones.ts would both want /zones/:id/rules, ' +
    'note that this unit OWNS rules; ensure index.ts mounts a rulesRouter (read index.ts; if rules is mounted under the ' +
    'zones path, coordinate by exporting from routes/rules.ts exactly what index.ts imports). Self-check: npm run -w ' +
    '@teranode/api typecheck.'),
  () => unit('3.4 alerts/harvest',
    'Implement apps/api/src/routes/alerts.ts + routes/harvest.ts (overwrite stubs, keep export names) + services/alerts.ts. ' +
    'GET /alerts (customer-scoped, newest first, include message_en + message_ne), POST /alerts/:id/ack (set ' +
    'acknowledged_at = now). GET/POST /harvest (harvest_log for the customer farms; POST body {zoneId, cropId, harvestedAt, ' +
    'yieldKg?, notes?}). Self-check: npm run -w @teranode/api typecheck.'),
  () => unit('3.5 crops catalog',
    'Implement apps/api/src/routes/crops.ts + services/crops.ts (overwrite stub, keep export name). GET /crops + GET ' +
    '/crops/:id (any authenticated user) returning each crop joined with its crop_stages from the DB, shaped per ' +
    '@teranode/types Crop. POST /crops, PATCH /crops/:id, PATCH /crops/:id/stages (requireAdmin). Self-check: npm run -w ' +
    '@teranode/api typecheck.'),
  () => unit('3.6 analytics/export',
    'Implement apps/api/src/routes/analytics.ts + services/analytics.ts (overwrite stub, keep export name). Customer-scoped. ' +
    'GET /analytics/usage?farmId&from&to&agg (query the usage_1d continuous aggregate for water_liters + dose_ml totals per ' +
    'day), GET /analytics/savings?farmId&from&to (estimate savings vs a flood-irrigation baseline: e.g. baseline ~ ' +
    'area-based liters; return {actualLiters, baselineLiters, savedLiters, savedPercent}), GET /analytics/export?farmId&' +
    'from&to&format=csv (hand-roll CSV text, set content-type text/csv + a content-disposition filename header). Self-check: ' +
    'npm run -w @teranode/api typecheck.'),
])

return { phase: 'P3 Routes', units: results }
