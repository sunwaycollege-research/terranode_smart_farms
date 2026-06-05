// MQTT command publisher for the TERANODE API.
//
// The API never subscribes to MQTT (that is the ingest worker's job); it only
// *publishes* two flavours of message to the broker:
//
//   - publishCommand(topic, payload)         — QoS 1 actuator commands
//     (`teranode/{accountId}/{farmId}/{gatewayId}/cmd`). At-least-once so a
//     valve open/close is not silently dropped on a transient broker blip.
//   - publishRetainedConfig(topic, payload)  — retained gateway config so a
//     gateway that (re)connects immediately receives its latest desired config
//     without waiting for the next push.
//
// One lazily-established connection per process (MQTT_URL). The client buffers
// publishes while offline (mqtt.js default queue) and flushes on (re)connect,
// so callers never have to await connectivity — they just await the publish
// resolving once the packet has been handed to the client.
//
// Loaded via the shared MQTT_URL convention; falls back to the localhost broker
// if the env var is missing. routes/actuators.ts can `import { publishCommand }`
// from here without any further wiring.

import 'dotenv/config';
import mqtt, { type MqttClient, type IClientPublishOptions } from 'mqtt';

const MQTT_URL = process.env.MQTT_URL ?? 'mqtt://localhost:1883';

let client: MqttClient | null = null;

/** Lazily create (and memoise) the shared publisher connection. */
function getClient(): MqttClient {
  if (client) return client;
  const c = mqtt.connect(MQTT_URL, {
    // A stable-ish client id so broker-side session/logging is legible. The
    // random suffix avoids collisions if the process is ever run twice.
    clientId: `teranode-api-pub-${Math.random().toString(16).slice(2, 10)}`,
    reconnectPeriod: 2000,
    connectTimeout: 10_000,
    // Buffer outgoing publishes while (re)connecting so callers never block on
    // connectivity; mqtt.js flushes the queue once the link is up.
    queueQoSZero: true,
  });
  c.on('error', (err) => {
    // A broker blip must not crash the API; log once per event.
    console.error('[mqtt-pub]', err.message);
  });
  client = c;
  return c;
}

/** Promisified publish wrapper shared by both exported helpers. */
function publish(
  topic: string,
  payloadObj: unknown,
  opts: IClientPublishOptions,
): Promise<void> {
  const c = getClient();
  const body = JSON.stringify(payloadObj);
  return new Promise<void>((resolve, reject) => {
    c.publish(topic, body, opts, (err) => {
      if (err) reject(err);
      else resolve();
    });
  });
}

/**
 * Publish an actuator command at QoS 1 (at-least-once). Use for
 * `teranode/{accountId}/{farmId}/{gatewayId}/cmd` actuator commands so an
 * open/close/dose is delivered even across a transient broker disconnect.
 */
export function publishCommand(topic: string, payloadObj: unknown): Promise<void> {
  return publish(topic, payloadObj, { qos: 1 });
}

/**
 * Publish a *retained* gateway-config message (QoS 1). The broker keeps the
 * last retained payload per topic so a gateway reconnecting later immediately
 * receives its current desired config.
 */
export function publishRetainedConfig(topic: string, payloadObj: unknown): Promise<void> {
  return publish(topic, payloadObj, { qos: 1, retain: true });
}

/** Close the shared MQTT connection (graceful shutdown / tests). */
export async function closeMqtt(): Promise<void> {
  if (!client) return;
  const c = client;
  client = null;
  await new Promise<void>((resolve) => c.end(false, {}, () => resolve()));
}
