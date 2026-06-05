export const meta = {
  name: 'teranode-p4-realtime',
  description: 'Phase 4 — MQTT ingest worker + hardware-free virtual gateway publisher + WebSocket live fan-out for TERANODE. Build-only; the operator verifies the round-trip inline.',
  phases: [{ title: 'P4 Ingest/RT', detail: 'ingest worker + virtual gateway + websocket' }],
}

const SPEC = 'docs/BUILD-SPEC.md'
const PRE =
  'You are one autonomous build agent for TERANODE. Repo root is your cwd (NOT git). FIRST read ' + SPEC +
  ' fully (data model, MQTT topic scheme + telemetry payload in section 5, file-ownership in section 8). Phases 1-3 are DONE: ' +
  'packages/types + packages/agronomy implemented & tested; the API (apps/api) has full routes + db (Drizzle schema + raw-SQL ' +
  'migrate + seed) and is verified against a LIVE seeded Postgres/Timescale. Infra is UP via docker: TimescaleDB on host port ' +
  '5433 (db teranode/teranode), Redis on 6380, Mosquitto MQTT on 1883. Env at apps/api/.env and apps/ingest/.env and root .env ' +
  'define DATABASE_URL=postgres://teranode:teranode@localhost:5433/teranode , REDIS_URL=redis://localhost:6380 , ' +
  'MQTT_URL=mqtt://localhost:1883 , SIM_TICK_MS=2000. IMPORTANT: load env via `import \'dotenv/config\'` at the top of any ' +
  'runnable entrypoint you create (the apps/ingest scripts run with cwd=apps/ingest so dotenv reads apps/ingest/.env), and ' +
  'still fall back to those localhost defaults if a var is missing. READ apps/api/src/db/schema.ts + apps/api/src/db/seed.ts ' +
  '(to learn the seeded farm/gateway/zone/sensor_channel ids + the telemetry/usage_events table columns), apps/api/src/lib/' +
  'jwt.ts + lib/redis.ts (reuse the same JWT verify + redis URL conventions), and apps/api/src/ws/index.ts (current stub you ' +
  'may replace if you own it). RULES: extensionless relative imports; no npm installs (mqtt, pg, ioredis, ws all installed); ' +
  'write ONLY the files your unit owns; do NOT modify apps/api/src/index.ts (it already calls attachWebsocket(server)). ' +
  'Before finishing, run the relevant typecheck (npm run -w @teranode/ingest typecheck or npm run -w @teranode/api typecheck) ' +
  'and fix your own errors. Return ONLY the structured object your schema requires.'

const UNIT_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: {
    unit: { type: 'string' },
    filesWritten: { type: 'array', items: { type: 'string' } },
    summary: { type: 'string' },
    howToRun: { type: 'string', description: 'exact command to start this component' },
    selfCheck: {
      type: 'object', additionalProperties: false,
      properties: { command: { type: 'string' }, passed: { type: 'boolean' }, detail: { type: 'string' } },
      required: ['command', 'passed', 'detail'],
    },
  }, required: ['unit', 'filesWritten', 'summary', 'howToRun', 'selfCheck'],
}

const unit = (label, instructions) =>
  agent(PRE + '\n\n## YOUR UNIT: ' + label + '\n' + instructions, { label, phase: 'P4 Ingest/RT', schema: UNIT_SCHEMA })

const results = await parallel([
  () => unit('4.1 MQTT ingest worker',
    'Implement apps/ingest/src/index.ts (entrypoint, import dotenv/config) + src/handlers/*.ts + src/db.ts (a pg Pool). ' +
    'Connect to MQTT (MQTT_URL), Postgres (DATABASE_URL), and Redis (REDIS_URL). Subscribe to: ' +
    'teranode/+/+/+/telemetry/zone/+ , teranode/+/+/+/telemetry/weather , teranode/+/+/+/telemetry/gateway/health , and ' +
    'teranode/+/+/+/state/# . On a zone telemetry message: parse the JSON payload (fields per spec: moisture, ph, ec, n, p, k, ' +
    'soilTemp, plus optional airTemp/humidity/rain and valve/pump/dosing/mode), resolve the sensor_channels.id for that ' +
    'zone_id + channel type, INSERT one telemetry row per numeric channel (time=now, channel_id, zone_id, farm_id, value), ' +
    'INSERT usage_events (kind=\'water_liters\') when the zone is irrigating, and UPDATE actuators.state for the zone valve / ' +
    'farm pump. Then PUBLISH a normalized JSON update to Redis channels live:farm:{farmId} and live:zone:{zoneId} (so the API ' +
    'WS can fan it out). Track last-seen per gateway and, when health/telemetry stops (or an LWT/offline state arrives), INSERT ' +
    'an alert (type gateway_offline). Make topic parsing tolerant. Log a concise line per ingested batch. Self-check: ' +
    'npm run -w @teranode/ingest typecheck.'),
  () => unit('4.2 virtual gateway publisher',
    'Implement apps/ingest/src/virtual/index.ts (entrypoint, import dotenv/config) + any helpers under src/virtual/. This is ' +
    'the hardware-free field brain. At startup, load the seeded farm + its account_id + gateway + zones + each zone rule ' +
    '(moisture_low/high) + the latest moisture (or a seeded start) from Postgres. Then on an interval of SIM_TICK_MS, run the ' +
    'driftZones hysteresis for each zone: if the valve is open moisture rises ~+1.2 else falls ~-0.5 (clamp 8..96); in auto ' +
    'mode open the valve when moisture < rule.moisture_low and close when > moisture_high; the farm pump is on if any valve is ' +
    'open; jitter ph (~6.x), ec (~1-3), n/p/k, soilTemp. PUBLISH a telemetry JSON payload per zone to ' +
    'teranode/{accountId}/{farmId}/{gatewayId}/telemetry/zone/{zoneId} (QoS 1) with the fields the ingest worker (4.1) expects ' +
    '(moisture, ph, ec, n, p, k, soilTemp, valve, pump, dosing, mode). Also publish a periodic ' +
    'teranode/{accountId}/{farmId}/{gatewayId}/telemetry/gateway/health heartbeat. Keep an in-memory moisture state between ' +
    'ticks. This MUST run via: npm run -w @teranode/ingest virtual (package.json already maps that to src/virtual/index.ts). ' +
    'Self-check: npm run -w @teranode/ingest typecheck.'),
  () => unit('4.3 WebSocket live fan-out + MQTT command publish',
    'Replace the stub apps/api/src/ws/index.ts: implement attachWebsocket(server) that starts a ws (npm "ws") server on path ' +
    '/live, authenticates each connection by verifying the ?token=<JWT> query param with apps/api/src/lib/jwt.ts (close 4401 on ' +
    'bad token), accepts client messages {subscribe: {farmId?|zoneId?}}, subscribes (via a dedicated ioredis subscriber built ' +
    'from REDIS_URL) to the matching live:farm:{id} / live:zone:{id} Redis channels, and forwards received messages to the ' +
    'socket — but ONLY if the connection account is allowed to see them (customer: messages for their own account/farms; ' +
    'admin: all). Clean up subscriptions on socket close. Also implement apps/api/src/lib/mqttPublish.ts: a small module that ' +
    'connects to MQTT_URL and exports publishCommand(topic, payloadObj) (QoS 1) and publishRetainedConfig(topic, payloadObj) ' +
    '(retained) for actuator commands + gateway config — export it cleanly so routes/actuators.ts could call it later (do NOT ' +
    'edit routes/actuators.ts; just provide the module). Do NOT modify apps/api/src/index.ts. Self-check: ' +
    'npm run -w @teranode/api typecheck.'),
])

return { phase: 'P4 Ingest/RT', units: results }
