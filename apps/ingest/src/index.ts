// @teranode/ingest — MQTT → Postgres/Redis ingest worker (unit 4.1).
//
// Subscribes to the TERANODE telemetry/weather/health/state topics, validates
// + normalizes each message, writes telemetry / usage_events rows, reconciles
// actuator state, tracks gateway liveness (offline alerts), and publishes
// normalized live updates to Redis (live:farm:{id} / live:zone:{id}) for the
// API WebSocket fan-out (unit 4.3).
//
// Run with cwd=apps/ingest so `import 'dotenv/config'` reads apps/ingest/.env.
//   npm run -w @teranode/ingest start

import 'dotenv/config';

import mqtt, { type MqttClient } from 'mqtt';
import Redis from 'ioredis';
import { pool, closePool } from './db';
import { parseTopic, parseJson } from './handlers/topic';
import { handleZoneTelemetry, handleWeather } from './handlers/telemetry';
import { handleHealth, handleState } from './handlers/health';
import { markSeen, startLivenessWatchdog } from './handlers/liveness';
import { resolveDevice } from './handlers/resolve';

const MQTT_URL = process.env.MQTT_URL ?? 'mqtt://localhost:1883';
const REDIS_URL = process.env.REDIS_URL ?? 'redis://localhost:6380';

// Subscriptions (spec): zone telemetry, weather, gateway health, and all state.
const SUBSCRIPTIONS = [
  // device-id-first (the device knows only its serial; resolved to account/farm):
  'teranode/dev/+/telemetry/zone/+',
  'teranode/dev/+/telemetry/weather',
  'teranode/dev/+/telemetry/gateway/health',
  'teranode/dev/+/state/#',
  // explicit-triple (legacy) form: teranode/{account}/{farm}/{gateway}/...
  'teranode/+/+/+/telemetry/zone/+',
  'teranode/+/+/+/telemetry/weather',
  'teranode/+/+/+/telemetry/gateway/health',
  'teranode/+/+/+/state/#',
  // legacy/short forms the @teranode/types topic helpers emit:
  'teranode/+/+/+/weather',
  'teranode/+/+/+/health',
];

// --- batched logging ----------------------------------------------------------
let batchRows = 0;
let batchMsgs = 0;
let batchUsage = 0;
let lastFlush = Date.now();

function noteBatch(rows: number, usage = 0): void {
  batchMsgs += 1;
  batchRows += rows;
  batchUsage += usage;
  const now = Date.now();
  if (now - lastFlush >= 5_000 && batchMsgs > 0) {
    console.log(
      `[ingest] batch: ${batchMsgs} msgs → ${batchRows} telemetry rows, ${batchUsage} usage events`,
    );
    batchMsgs = 0;
    batchRows = 0;
    batchUsage = 0;
    lastFlush = now;
  }
}

async function main(): Promise<void> {
  // Redis (publisher) ----------------------------------------------------------
  const redis = new Redis(REDIS_URL, { maxRetriesPerRequest: 2 });
  redis.on('error', (err) => console.error('[ingest][redis]', err.message));

  // Postgres warm-up -----------------------------------------------------------
  try {
    await pool.query('SELECT 1');
    console.log('[ingest] postgres connected');
  } catch (err) {
    console.error('[ingest] postgres connect failed:', (err as Error).message);
  }

  // Liveness watchdog ----------------------------------------------------------
  const stopWatchdog = startLivenessWatchdog(redis);

  // MQTT -----------------------------------------------------------------------
  const client: MqttClient = mqtt.connect(MQTT_URL, {
    reconnectPeriod: 2_000,
    clientId: `teranode-ingest-${process.pid}`,
    clean: true,
  });

  client.on('connect', () => {
    console.log(`[ingest] mqtt connected → ${MQTT_URL}`);
    for (const topic of SUBSCRIPTIONS) {
      client.subscribe(topic, { qos: 0 }, (err) => {
        if (err) console.error(`[ingest] subscribe failed ${topic}:`, err.message);
      });
    }
    console.log(`[ingest] subscribed to ${SUBSCRIPTIONS.length} topic patterns`);
  });

  client.on('reconnect', () => console.log('[ingest] mqtt reconnecting…'));
  client.on('error', (err) => console.error('[ingest][mqtt]', err.message));

  client.on('message', (topic, raw) => {
    void dispatch(redis, topic, raw).catch((err) =>
      console.error('[ingest] handler error:', (err as Error).message),
    );
  });

  // Graceful shutdown ----------------------------------------------------------
  const shutdown = async (signal: string): Promise<void> => {
    console.log(`[ingest] ${signal} → shutting down`);
    stopWatchdog();
    try {
      client.end(true);
    } catch {
      /* ignore */
    }
    try {
      await closePool();
    } catch {
      /* ignore */
    }
    try {
      redis.disconnect();
    } catch {
      /* ignore */
    }
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));

  console.log('[ingest] worker up.');
}

/** Route one MQTT message to the right handler. */
async function dispatch(redis: Redis, topic: string, raw: Buffer): Promise<void> {
  const parsed = parseTopic(topic);
  if (parsed.kind === 'unknown' || parsed.kind === 'cmd') return;

  // Device-id-first topic (teranode/dev/{serial}/...): the device knows only its
  // serial, so resolve account/farm/gateway (+ zone ids) from the DB binding.
  if (parsed.serial && !parsed.gatewayId) {
    const route = await resolveDevice(parsed.serial);
    if (!route) return; // unknown / not yet provisioned → drop until linked
    parsed.accountId = route.accountId;
    parsed.farmId = route.farmId;
    parsed.gatewayId = route.gatewayId;
    // The device numbers its zones locally (1-based); map to the real zone uuid.
    if (parsed.kind === 'zone' && parsed.zoneId) {
      const idx = Number(parsed.zoneId);
      if (Number.isInteger(idx) && idx >= 1 && route.zoneIds[idx - 1]) {
        parsed.zoneId = route.zoneIds[idx - 1];
      }
    }
  }

  // mark the originating gateway as alive (re-arms offline alerting)
  markSeen(parsed.gatewayId, parsed.accountId, parsed.farmId);

  const payload = parseJson<Record<string, unknown>>(raw);
  if (payload === null || typeof payload !== 'object') {
    // health/state may send an empty/non-JSON LWT — still treat empty offline.
    if (parsed.kind === 'health' || parsed.kind === 'state') {
      await handleHealth(redis, parsed, { status: 'offline' });
    }
    return;
  }

  switch (parsed.kind) {
    case 'zone': {
      const stats = await handleZoneTelemetry(redis, parsed, payload);
      if (stats) noteBatch(stats.rows, stats.irrigating ? 1 : 0);
      break;
    }
    case 'weather': {
      const stats = await handleWeather(redis, parsed, payload);
      if (stats) noteBatch(stats.rows);
      break;
    }
    case 'health': {
      await handleHealth(redis, parsed, payload);
      break;
    }
    case 'state': {
      const stats = await handleState(redis, parsed, payload);
      if (stats) noteBatch(0, stats.usage);
      break;
    }
    default:
      break;
  }
}

main().catch((err) => {
  console.error('[ingest] fatal:', err);
  process.exit(1);
});
