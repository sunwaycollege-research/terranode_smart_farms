// @teranode/ingest — virtual gateway publisher (unit 4.2).
//
// The hardware-free "field brain". At startup it loads the seeded customer farm
// (account_id + gateway + zones + per-zone moisture rule + latest/seeded
// moisture) from Postgres, then every SIM_TICK_MS it:
//   1. runs the legacy `driftZones` hysteresis (open valve when moisture < low,
//      close when > high; pump on if any valve open) and jitters the secondary
//      channels (ph/ec/n/p/k/soilTemp),
//   2. publishes a telemetry JSON payload per zone (QoS 1) to
//        teranode/{accountId}/{farmId}/{gatewayId}/telemetry/zone/{zoneId}
//      carrying both a typed `readings[]` array (what the ingest worker 4.1
//      consumes to write the telemetry hypertable) and the flat convenience
//      fields (moisture, ph, ec, n, p, k, soilTemp, valve, pump, dosing, mode),
//   3. periodically publishes a gateway-health heartbeat to
//        teranode/{accountId}/{farmId}/{gatewayId}/telemetry/gateway/health.
//
// Moisture (and valve/pump) state is held in memory between ticks; the DB is
// only read once at boot. Run with:  npm run -w @teranode/ingest virtual
// (cwd = apps/ingest, so dotenv reads apps/ingest/.env).

import 'dotenv/config';
import mqtt, { type MqttClient } from 'mqtt';
import { MQTT_ROOT, telemetryTopic } from '@teranode/types';
import { loadFarmContext, type FarmContext } from './db';
import { driftZones, type ZoneSimState } from './drift';

const MQTT_URL = process.env.MQTT_URL ?? 'mqtt://localhost:1883';
const TICK_MS = Number(process.env.SIM_TICK_MS ?? 2000) || 2000;
// Emit a health heartbeat roughly every 15s (or every tick if the tick is slow).
const HEALTH_EVERY_MS = 15_000;

/** Gateway-health heartbeat topic (per task spec: telemetry/gateway/health). */
function gatewayHealthTopic(
  accountId: string,
  farmId: string,
  gatewayId: string,
): string {
  return `${MQTT_ROOT}/${accountId}/${farmId}/${gatewayId}/telemetry/gateway/health`;
}

const round1 = (v: number): number => Math.round(v * 10) / 10;
const round2 = (v: number): number => Math.round(v * 100) / 100;

/**
 * Build the per-zone telemetry payload. It is a *superset*: the typed
 * `readings[]` array (DB channel-type strings + quality) drives the ingest
 * worker's hypertable writes, while the flat fields make the payload trivially
 * consumable / loggable. Channel keys use the DB `channel_type` spelling
 * (`soiltemp`, not `soilTemp`) so the worker can match `sensor_channels.type`.
 */
function buildTelemetryPayload(z: ZoneSimState, pump: boolean, ts: string) {
  const moisture = round1(z.moisture);
  const ph = round1(z.ph);
  const ec = round2(z.ec);
  const soilTemp = round1(z.soilTemp);
  return {
    ts,
    zoneId: z.zoneId,
    // typed readings consumed by the ingest worker (4.1) ------------------
    readings: [
      { channel: 'moisture', value: moisture, quality: 1 },
      { channel: 'ph', value: ph, quality: 1 },
      { channel: 'ec', value: ec, quality: 1 },
      { channel: 'n', value: z.n, quality: 1 },
      { channel: 'p', value: z.p, quality: 1 },
      { channel: 'k', value: z.k, quality: 1 },
      { channel: 'soiltemp', value: soilTemp, quality: 1 },
    ],
    // flat convenience fields (per task contract) -------------------------
    moisture,
    ph,
    ec,
    n: z.n,
    p: z.p,
    k: z.k,
    soilTemp,
    valve: z.valve,
    pump,
    dosing: false,
    mode: z.mode,
  };
}

function publishTick(client: MqttClient, ctx: FarmContext): void {
  const { pump } = driftZones(ctx.zones);
  const ts = new Date().toISOString();

  for (const z of ctx.zones) {
    const topic = telemetryTopic(ctx.accountId, ctx.farmId, ctx.gatewayId, z.zoneId);
    const payload = buildTelemetryPayload(z, pump, ts);
    client.publish(topic, JSON.stringify(payload), { qos: 1 });
  }

  const openCount = ctx.zones.filter((z) => z.valve).length;
  console.log(
    `[virtual] tick — pump=${pump ? 'ON' : 'off'} valvesOpen=${openCount}/${ctx.zones.length} ` +
      ctx.zones
        .map((z) => `${z.cropId ?? z.zoneId.slice(0, 4)}:${round1(z.moisture)}%${z.valve ? '*' : ''}`)
        .join(' '),
  );
}

function publishHealth(client: MqttClient, ctx: FarmContext): void {
  const topic = gatewayHealthTopic(ctx.accountId, ctx.farmId, ctx.gatewayId);
  const payload = {
    ts: new Date().toISOString(),
    status: 'online' as const,
    serial: ctx.serial,
    fwVersion: ctx.fwVersion,
    battery: 98,
    zones: ctx.zones.length,
  };
  // retained heartbeat so a late subscriber sees the gateway is alive.
  client.publish(topic, JSON.stringify(payload), { qos: 1, retain: true });
}

async function main(): Promise<void> {
  console.log('[virtual] loading farm context from Postgres...');
  const ctx = await loadFarmContext();
  console.log(
    `[virtual] farm=${ctx.farmId} gateway=${ctx.serial} (${ctx.gatewayId}) ` +
      `account=${ctx.accountId} zones=${ctx.zones.length} tick=${TICK_MS}ms`,
  );

  const client = mqtt.connect(MQTT_URL, {
    clientId: `teranode-virtual-${ctx.gatewayId.slice(0, 8)}-${Date.now()}`,
    clean: true,
    reconnectPeriod: 2000,
    // Last-will: if this process dies, brokers tell subscribers we went offline.
    will: {
      topic: gatewayHealthTopic(ctx.accountId, ctx.farmId, ctx.gatewayId),
      payload: JSON.stringify({
        ts: new Date().toISOString(),
        status: 'offline',
        serial: ctx.serial,
      }),
      qos: 1,
      retain: true,
    },
  });

  let tickTimer: ReturnType<typeof setInterval> | null = null;
  let healthTimer: ReturnType<typeof setInterval> | null = null;

  client.on('connect', () => {
    console.log(`[virtual] connected to MQTT broker at ${MQTT_URL}`);
    // immediate first heartbeat + first telemetry tick, then on intervals.
    publishHealth(client, ctx);
    publishTick(client, ctx);
    if (!tickTimer) tickTimer = setInterval(() => publishTick(client, ctx), TICK_MS);
    if (!healthTimer) {
      healthTimer = setInterval(
        () => publishHealth(client, ctx),
        Math.max(HEALTH_EVERY_MS, TICK_MS),
      );
    }
  });

  client.on('error', (err) => {
    console.error('[virtual] mqtt error:', err.message);
  });
  client.on('reconnect', () => {
    console.log('[virtual] reconnecting to MQTT broker...');
  });

  const shutdown = (signal: string): void => {
    console.log(`\n[virtual] ${signal} — shutting down...`);
    if (tickTimer) clearInterval(tickTimer);
    if (healthTimer) clearInterval(healthTimer);
    // publish a clean offline heartbeat, then close.
    try {
      const topic = gatewayHealthTopic(ctx.accountId, ctx.farmId, ctx.gatewayId);
      client.publish(
        topic,
        JSON.stringify({ ts: new Date().toISOString(), status: 'offline', serial: ctx.serial }),
        { qos: 1, retain: true },
        () => client.end(false, () => process.exit(0)),
      );
    } catch {
      client.end(true, () => process.exit(0));
    }
    // hard exit safety net.
    setTimeout(() => process.exit(0), 1500);
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((err) => {
  console.error('[virtual] fatal:', err);
  process.exit(1);
});
