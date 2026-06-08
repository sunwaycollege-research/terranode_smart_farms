// TerraNode device simulator (DEVICE-ID-FIRST) — a hardware-free stand-in for the
// real ESP32 firmware (firmware/teranode_gateway + TerraNode/schematik_esp32.ino).
//
// It behaves exactly like a flashed brain: phones home via POST /provision with
// only its { serial, secret }, then streams 7-in-1 soil + DHT22 + rain + YF-S201
// flow telemetry over MQTT on the device-id-first topics, running the same
// moisture-hysteresis irrigation loop. The ingest worker resolves the serial →
// account/farm and the local `zone/1` index → the real zone, so a CLAIMED device
// comes ONLINE and the farmer's app shows live data — no hardware required.
//
// Run (from the ingest workspace):
//   SERIAL=<serial> SECRET=<secret> [API_BASE=http://localhost:4000]
//   [MQTT_URL=mqtt://localhost:1883] [TICK_MS=4000] tsx src/virtual/device-sim.ts

import mqtt from 'mqtt';

const API = process.env.API_BASE ?? 'http://localhost:4000';
const MQTT_URL = process.env.MQTT_URL ?? 'mqtt://localhost:1883';
const SERIAL = process.env.SERIAL ?? '';
const SECRET = process.env.SECRET ?? '';
const TICK = Number(process.env.TICK_MS ?? 4000);
const HEALTH_EVERY = 6; // gateway-health heartbeat every N ticks

if (!SERIAL || !SECRET) {
  console.error('[device-sim] SERIAL and SECRET env vars are required');
  process.exit(1);
}

const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);
const rnd = (a: number, b: number) => a + Math.random() * (b - a);
const r1 = (v: number) => Math.round(v * 10) / 10;
const r2 = (v: number) => Math.round(v * 100) / 100;

// Simulated sensor + control state (tomato-ish bands; mirrors the firmware).
const MOISTURE_LOW = 45;
const MOISTURE_HIGH = 70;
let moisture = 52;
let valve = false;
let ph = 6.4;
let ec = 1.8;
let n = 95;
let p = 36;
let k = 185;
let soilTemp = 22;

async function provision(): Promise<{ topicPrefix: string; farmId?: string; status?: string }> {
  const res = await fetch(`${API}/provision`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      serial: SERIAL,
      secret: SECRET,
      fwVersion: '1.0.0-sim',
      wifiSsid: 'sim-wifi',
      capabilities: {
        channels: ['moisture', 'soiltemp', 'ec', 'ph', 'n', 'p', 'k', 'airtemp', 'humidity', 'rain', 'flow'],
        zones: 1,
        pump: true,
      },
    }),
  });
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (res.status !== 200 && res.status !== 202) {
    throw new Error(`provision HTTP ${res.status}: ${JSON.stringify(body)}`);
  }
  return body as { topicPrefix: string; farmId?: string; status?: string };
}

/** One control-loop tick: hysteresis valve + moisture drift + channel jitter. */
function step(): void {
  if (!valve && moisture < MOISTURE_LOW) valve = true;
  else if (valve && moisture > MOISTURE_HIGH) valve = false;
  moisture = clamp(moisture + (valve ? rnd(0.8, 1.6) : -rnd(0.3, 0.7)), 8, 96);
  ph = clamp(ph + rnd(-0.05, 0.05), 5.6, 7.2);
  ec = clamp(ec + rnd(-0.05, 0.05), 0.8, 3.2);
  n = clamp(n + rnd(-3, 3), 30, 200);
  p = clamp(p + rnd(-2, 2), 20, 70);
  k = clamp(k + rnd(-4, 4), 110, 300);
  soilTemp = clamp(soilTemp + rnd(-0.2, 0.2), 12, 32);
}

async function main(): Promise<void> {
  console.log(`[device-sim] ${SERIAL} → provisioning at ${API} …`);
  let info: { topicPrefix: string; farmId?: string; status?: string } | undefined;
  // Retry until the device is claimed + linked (POST /provision returns 'pending'
  // until an admin has claimed it to a customer).
  for (;;) {
    try {
      const res = await provision();
      if (res.status === 'pending') {
        console.log('[device-sim] not yet claimed (pending) — retrying in 5s');
      } else {
        info = res;
        break;
      }
    } catch (e) {
      console.error('[device-sim]', (e as Error).message, '— retrying in 5s');
    }
    await new Promise((r) => setTimeout(r, 5000));
  }

  const prefix = info!.topicPrefix || `teranode/dev/${SERIAL}`;
  console.log(`[device-sim] linked → farm ${info!.farmId ?? '?'} · publishing to ${prefix}/…`);

  const client = mqtt.connect(MQTT_URL, {
    username: SERIAL,
    password: SECRET,
    will: {
      topic: `${prefix}/telemetry/gateway/health`,
      payload: JSON.stringify({ status: 'offline' }),
      qos: 0,
      retain: true,
    },
  });

  let ticks = 0;
  client.on('connect', () => {
    console.log('[device-sim] MQTT connected — streaming live telemetry');
    const publishTick = (): void => {
      step();
      const airTemp = clamp(soilTemp + rnd(2, 6), 14, 38);
      const humidity = clamp(rnd(55, 85), 20, 100);
      const raining = Math.random() < 0.04;
      const flow = valve ? rnd(9, 13) : 0;

      client.publish(
        `${prefix}/telemetry/zone/1`,
        JSON.stringify({
          moisture: r1(moisture),
          soilTemp: r1(soilTemp),
          ec: r2(ec),
          ph: r1(ph),
          n: Math.round(n),
          p: Math.round(p),
          k: Math.round(k),
          valve,
          pump: valve,
          mode: 'auto',
        }),
      );
      client.publish(
        `${prefix}/telemetry/weather`,
        JSON.stringify({ airTemp: r1(airTemp), humidity: r1(humidity), rain: raining ? 1 : 0, flow: r1(flow) }),
      );
      client.publish(`${prefix}/state/zone/1`, JSON.stringify({ valve, pump: valve }), { retain: true });
      if (ticks % HEALTH_EVERY === 0) {
        client.publish(
          `${prefix}/telemetry/gateway/health`,
          JSON.stringify({ status: 'online', fwVersion: '1.0.0-sim', rssi: -57, uptimeS: Math.floor(process.uptime()) }),
          { retain: true },
        );
      }
      ticks += 1;
      if (ticks % 10 === 0) {
        console.log(`[device-sim] tick ${ticks} · moisture ${r1(moisture)}% · valve ${valve ? 'OPEN' : 'shut'} · flow ${r1(flow)} L/min`);
      }
    };
    publishTick();
    setInterval(publishTick, TICK);
  });
  client.on('error', (e) => console.error('[device-sim] mqtt error:', e.message));
}

void main();
