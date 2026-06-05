// ============================================================================
// TERANODE — in-memory mock backend (2-role world).
//
// Mirrors the Express API surface in BUILD-SPEC §5 so the mobile app can run
// hardware-free until the cutover (app.json → extra.useMockApi=false). The
// method→endpoint map in src/api/client.ts is 1:1 with this store, so flipping
// the flag is the only change required.
//
// Seed (parity with the server seed in §2):
//   • 1 admin root + admin user (admin@teranode.io)
//   • 1 customer "Green Valley Farm" + customer user (farmer@greenvalley.np)
//   • 1 farm + 1 esp32 gateway (TN-ESP32-0001, online) + 1 node
//   • 3 zones — Zone 1 tomato (~65d → fruiting), Zone 2 capsicum (~45d →
//     flowering), Zone 3 spinach (~12d → vegetative) — with sensor channels,
//     crop-derived rules and live readings.
//   • all 14 crops + the 9-module device catalog, seeded from @teranode/agronomy
//     and @teranode/types respectively.
//
// A tiny "virtual gateway" runs the legacy driftZones hysteresis on an interval:
// moisture rises while a valve is open and dries out when closed, the auto
// controller opens/closes at the moisture low/high band, the main pump follows
// "any valve open", and pH/EC/soil-temp/N-P-K jitter. zoneAnalysis() defers to
// @teranode/agronomy analyzeZone() so health + recommendations EXACTLY match the
// server.
// ============================================================================

import {
  CROPS,
  getCrop,
  analyzeZone,
  type Channel,
  type ChannelReadings,
  type Crop,
  type ZoneAnalysis,
} from '@teranode/agronomy';
import {
  CHANNEL_DB_MAP,
  DEVICE_CATALOG,
  defaultEntitlements,
  type Account,
  type Actuator,
  type Alert,
  type CropRef,
  type DeviceCatalogItem,
  type Entitlements,
  type EntitlementRecord,
  type Farm,
  type Gateway,
  type HarvestLog,
  type Node,
  type PublicUser,
  type Rule,
  type SensorChannel,
  type TelemetryBucket,
  type TelemetrySample,
  type UsageBucket,
  type Zone,
} from '@teranode/types';

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

const nowIso = (): string => new Date().toISOString();
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const round1 = (v: number) => Math.round(v * 10) / 10;
const jitter = (v: number, d: number) => v + (Math.random() - 0.5) * d;
let idSeq = 0;
const uid = (prefix: string) => `${prefix}_${(++idSeq).toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

/** ISO date `n` whole days before today (planting dates). */
function daysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------
// accounts & users (admin root + one customer)
// ---------------------------------------------------------------------------

const ADMIN_ACCOUNT_ID = 'acc_admin';
const CUSTOMER_ACCOUNT_ID = 'acc_greenvalley';

export const accounts: Account[] = [
  {
    id: ADMIN_ACCOUNT_ID,
    type: 'admin',
    name: 'TERANODE',
    parentId: null,
    status: 'active',
    plan: null,
    locale: 'en',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  },
  {
    id: CUSTOMER_ACCOUNT_ID,
    type: 'customer',
    name: 'Green Valley Farm',
    parentId: ADMIN_ACCOUNT_ID,
    status: 'active',
    plan: 'pro',
    locale: 'en',
    createdAt: '2026-03-18T00:00:00.000Z',
    updatedAt: '2026-03-18T00:00:00.000Z',
  },
];

export const users: PublicUser[] = [
  {
    id: 'usr_admin',
    accountId: ADMIN_ACCOUNT_ID,
    email: 'admin@teranode.io',
    name: 'TERANODE Admin',
    role: 'admin',
    locale: null,
    createdAt: '2026-01-01T00:00:00.000Z',
  },
  {
    id: 'usr_farmer',
    accountId: CUSTOMER_ACCOUNT_ID,
    email: 'farmer@greenvalley.np',
    name: 'R. Thapa',
    role: 'customer',
    locale: 'ne',
    createdAt: '2026-03-18T00:00:00.000Z',
  },
];

// ---------------------------------------------------------------------------
// device catalog + entitlements (seeded from @teranode/types)
// ---------------------------------------------------------------------------

export const deviceCatalog: DeviceCatalogItem[] = DEVICE_CATALOG.map((d) => ({ ...d }));

const entitlements: EntitlementRecord[] = [
  {
    accountId: CUSTOMER_ACCOUNT_ID,
    values: {
      ...defaultEntitlements(),
      zoneNodes: 3,
      reservoirMonitoring: true,
      flowMeter: true,
      analytics: true,
    } as Entitlements,
    updatedBy: 'usr_admin',
    updatedAt: '2026-03-18T00:00:00.000Z',
  },
];

// ---------------------------------------------------------------------------
// farm, gateway, node
// ---------------------------------------------------------------------------

const FARM_ID = 'farm_greenvalley';

export const farms: Farm[] = [
  {
    id: FARM_ID,
    accountId: CUSTOMER_ACCOUNT_ID,
    name: 'Green Valley Farm',
    timezone: 'Asia/Kathmandu',
    geo: { lat: 27.7172, lon: 85.324 },
    createdAt: '2026-03-18T00:00:00.000Z',
  },
];

export const gateways: Gateway[] = [
  {
    id: 'gw_0001',
    serial: 'TN-ESP32-0001',
    farmId: FARM_ID,
    accountId: CUSTOMER_ACCOUNT_ID,
    compute: 'esp32',
    fwVersion: '0.9.2',
    status: 'online',
    lastSeen: nowIso(),
    createdAt: '2026-03-18T00:00:00.000Z',
  },
];

export const nodes: Node[] = [
  {
    id: 'node_z1',
    gatewayId: 'gw_0001',
    radioAddr: '0xA1',
    battery: 92,
    lastSeen: nowIso(),
    createdAt: '2026-03-18T00:00:00.000Z',
  },
  {
    id: 'node_z2',
    gatewayId: 'gw_0001',
    radioAddr: '0xA2',
    battery: 18,
    lastSeen: nowIso(),
    createdAt: '2026-03-18T00:00:00.000Z',
  },
  {
    id: 'node_z3',
    gatewayId: 'gw_0001',
    radioAddr: '0xA3',
    battery: 74,
    lastSeen: nowIso(),
    createdAt: '2026-03-18T00:00:00.000Z',
  },
];

// ---------------------------------------------------------------------------
// zones — three crops at three life stages
// ---------------------------------------------------------------------------

export const zones: Zone[] = [
  {
    id: 'zone_1',
    farmId: FARM_ID,
    name: 'Zone 1',
    cropId: 'tomato',
    plantingDate: daysAgo(65), // → fruiting
    areaM2: 240,
    nodeId: 'node_z1',
    mode: 'auto',
    createdAt: '2026-03-18T00:00:00.000Z',
  },
  {
    id: 'zone_2',
    farmId: FARM_ID,
    name: 'Zone 2',
    cropId: 'capsicum',
    plantingDate: daysAgo(45), // → flowering
    areaM2: 180,
    nodeId: 'node_z2',
    mode: 'auto',
    createdAt: '2026-03-18T00:00:00.000Z',
  },
  {
    id: 'zone_3',
    farmId: FARM_ID,
    name: 'Zone 3',
    cropId: 'spinach',
    plantingDate: daysAgo(12), // → vegetative
    areaM2: 120,
    nodeId: 'node_z3',
    mode: 'manual',
    createdAt: '2026-03-18T00:00:00.000Z',
  },
];

// ---------------------------------------------------------------------------
// live readings + control state (the "virtual gateway" mutates these)
// ---------------------------------------------------------------------------

/** Live engine-channel readings for one zone, plus controller state. */
interface ZoneRuntime {
  readings: Required<Pick<ChannelReadings, Channel>>;
  valveOpen: boolean;
  /** Accumulated water (litres) dispensed while the valve has been open. */
  litersToday: number;
  /** Accumulated fertilizer dose (mL) while dosing. */
  doseMlToday: number;
}

/** The eight engine channels we simulate. */
const SIM_CHANNELS: Channel[] = ['moisture', 'ph', 'ec', 'n', 'p', 'k', 'soilTemp', 'airTemp'];

/** Seed a zone's runtime readings from the midpoint of its current-stage band. */
function seedRuntime(zone: Zone, startMoisture: number, valveOpen: boolean): ZoneRuntime {
  const crop = getCrop(zone.cropId ?? '');
  const band = crop?.ideal;
  const mid = (key: Channel): number => {
    if (!band) return 0;
    const [lo, hi] = band[key];
    return (lo + hi) / 2;
  };
  return {
    readings: {
      moisture: startMoisture,
      ph: round1(mid('ph')),
      ec: round1(mid('ec')),
      n: Math.round(mid('n')),
      p: Math.round(mid('p')),
      k: Math.round(mid('k')),
      soilTemp: round1(mid('soilTemp')),
      airTemp: round1(mid('airTemp')),
    },
    valveOpen,
    litersToday: 0,
    doseMlToday: 0,
  };
}

const runtime: Record<string, ZoneRuntime> = {
  // Zone 1 starts dry & watering, Zone 2 mid-band idle, Zone 3 manual-held.
  zone_1: seedRuntime(zones[0], 34, true),
  zone_2: seedRuntime(zones[1], 60, false),
  zone_3: seedRuntime(zones[2], 70, false),
};

// ---------------------------------------------------------------------------
// rules (crop-derived; recomputed on assign) + actuators + farm systems
// ---------------------------------------------------------------------------

const rules: Record<string, Rule> = {};

/** (Re)derive a zone's crop rule from the current stage and store it. */
function applyCropRule(zone: Zone): Rule {
  const a = analysis(zone.id);
  const r: Rule = {
    zoneId: zone.id,
    moistureLow: a.rule.moistureLow,
    moistureHigh: a.rule.moistureHigh,
    rainSkipMm: 4,
    phTarget: a.rule.phTarget,
    ecTarget: a.rule.ecTarget,
    source: 'crop',
    appliedStage: a.stage,
    updatedAt: nowIso(),
  };
  rules[zone.id] = r;
  return r;
}

/** One valve actuator per zone, one farm-scoped pump + dosing actuator. */
export const actuators: Actuator[] = [
  { id: 'act_valve_z1', scope: 'zone', zoneId: 'zone_1', farmId: null, type: 'valve', state: true, desired: null, mode: 'auto' },
  { id: 'act_valve_z2', scope: 'zone', zoneId: 'zone_2', farmId: null, type: 'valve', state: false, desired: null, mode: 'auto' },
  { id: 'act_valve_z3', scope: 'zone', zoneId: 'zone_3', farmId: null, type: 'valve', state: false, desired: null, mode: 'manual' },
  { id: 'act_pump', scope: 'farm', zoneId: null, farmId: FARM_ID, type: 'pump', state: true, desired: null, mode: 'auto' },
  { id: 'act_dosing', scope: 'farm', zoneId: null, farmId: FARM_ID, type: 'dosing', state: false, desired: null, mode: 'auto' },
];

const valveByZone: Record<string, string> = {
  zone_1: 'act_valve_z1',
  zone_2: 'act_valve_z2',
  zone_3: 'act_valve_z3',
};

// ---------------------------------------------------------------------------
// sensor channels (one row per simulated engine channel, per zone) + weather
// ---------------------------------------------------------------------------

export const sensorChannels: SensorChannel[] = [];
const channelUnit: Record<Channel, string> = {
  moisture: '%',
  ph: 'pH',
  ec: 'mS/cm',
  n: 'mg/kg',
  p: 'mg/kg',
  k: 'mg/kg',
  soilTemp: '°C',
  airTemp: '°C',
};
for (const z of zones) {
  for (const ch of ['moisture', 'ph', 'ec', 'n', 'p', 'k', 'soilTemp'] as Channel[]) {
    sensorChannels.push({
      id: `chan_${z.id}_${ch}`,
      zoneId: z.id,
      farmId: FARM_ID,
      type: CHANNEL_DB_MAP[ch] as SensorChannel['type'],
      unit: channelUnit[ch],
      calibration: {},
      enabled: true,
    });
  }
}
// farm-level weather channels.
for (const t of ['airtemp', 'humidity', 'pressure', 'rain'] as SensorChannel['type'][]) {
  sensorChannels.push({
    id: `chan_farm_${t}`,
    zoneId: null,
    farmId: FARM_ID,
    type: t,
    unit: t === 'airtemp' ? '°C' : t === 'humidity' ? '%' : t === 'pressure' ? 'hPa' : 'mm',
    calibration: {},
    enabled: true,
  });
}

let weather = { airTemp: 24, humidity: 58, pressure: 1012, rain1h: 0 };

// ---------------------------------------------------------------------------
// alerts + harvest log
// ---------------------------------------------------------------------------

export const alerts: Alert[] = [
  {
    id: 'al_1',
    accountId: CUSTOMER_ACCOUNT_ID,
    farmId: FARM_ID,
    zoneId: 'zone_2',
    severity: 'warn',
    type: 'low_battery',
    messageEn: 'Zone 2 sensor node battery at 18%.',
    messageNe: 'जोन २ सेन्सर नोडको ब्याट्री १८% मा छ।',
    ts: new Date(Date.now() - 3 * 3600_000).toISOString(),
    acknowledgedAt: null,
  },
  {
    id: 'al_2',
    accountId: CUSTOMER_ACCOUNT_ID,
    farmId: FARM_ID,
    zoneId: 'zone_1',
    severity: 'info',
    type: 'rain_skip',
    messageEn: 'Rain ≥ 4mm forecast — Zone 1 irrigation deferred.',
    messageNe: 'वर्षा ≥ ४mm पूर्वानुमान — जोन १ सिँचाइ स्थगित।',
    ts: new Date(Date.now() - 6 * 3600_000).toISOString(),
    acknowledgedAt: new Date(Date.now() - 5.8 * 3600_000).toISOString(),
  },
  {
    id: 'al_3',
    accountId: CUSTOMER_ACCOUNT_ID,
    farmId: FARM_ID,
    zoneId: 'zone_3',
    severity: 'critical',
    type: 'valve_no_flow',
    messageEn: 'Zone 3 valve open but no flow detected — check supply line.',
    messageNe: 'जोन ३ भल्भ खुला तर प्रवाह छैन — आपूर्ति लाइन जाँच गर्नुहोस्।',
    ts: new Date(Date.now() - 26 * 3600_000).toISOString(),
    acknowledgedAt: null,
  },
];

export const harvestLog: HarvestLog[] = [
  { id: 'hv_1', zoneId: 'zone_3', cropId: 'spinach', harvestedAt: daysAgo(40), yieldKg: 38, notes: 'First cut, good leaf size.' },
  { id: 'hv_2', zoneId: 'zone_1', cropId: 'tomato', harvestedAt: daysAgo(20), yieldKg: 64, notes: 'Early ripening cluster.' },
];

// ---------------------------------------------------------------------------
// telemetry history (rolling raw buffer per channel, for sparklines/charts)
// ---------------------------------------------------------------------------

const RAW_HISTORY = 240; // ~ keep last N ticks per channel
const telemetryHistory: Record<string, TelemetrySample[]> = {}; // key = `${zoneId}:${channel}`
const usageHistory: UsageBucket[] = [];

function pushSample(zoneId: string, channel: Channel, value: number) {
  const key = `${zoneId}:${channel}`;
  const arr = telemetryHistory[key] ?? (telemetryHistory[key] = []);
  arr.push({
    time: nowIso(),
    channelId: `chan_${zoneId}_${channel}`,
    zoneId,
    farmId: FARM_ID,
    value: round1(value),
    quality: 1,
  });
  if (arr.length > RAW_HISTORY) arr.shift();
}

// Backfill a day of synthetic daily usage so analytics has something to show.
(function seedUsage() {
  for (let d = 13; d >= 0; d--) {
    const date = daysAgo(d);
    for (const z of zones) {
      const liters = 40 + Math.random() * 60;
      usageHistory.push({ bucket: date, farmId: FARM_ID, zoneId: z.id, kind: 'water_liters', total: round1(liters) });
      usageHistory.push({ bucket: date, farmId: FARM_ID, zoneId: z.id, kind: 'fertilizer_ml', total: round1(Math.random() * 120) });
    }
  }
})();

// ---------------------------------------------------------------------------
// the virtual gateway — hysteresis control loop on an interval
// ---------------------------------------------------------------------------

/**
 * Advance the simulation one tick: drift readings, run the auto hysteresis
 * controller (open valve when moisture < low, close when > high), follow the
 * pump to "any valve open", jitter the secondary channels, and accumulate
 * usage. Pure mutation of module state; safe to call on a timer or on read.
 */
export function driftZones(): void {
  for (const z of zones) {
    const rt = runtime[z.id];
    if (!rt) continue;
    const rule = rules[z.id] ?? applyCropRule(z);

    // moisture physics: rises while watering, dries out otherwise.
    let m = rt.readings.moisture;
    m += rt.valveOpen ? 1.4 : -0.6;
    m = clamp(m, 6, 98);

    // auto controller (hysteresis); manual mode holds whatever the operator set.
    if (z.mode === 'auto') {
      if (m < rule.moistureLow) rt.valveOpen = true;
      else if (m > rule.moistureHigh) rt.valveOpen = false;
    }

    // secondary channels jitter gently within sane physical limits.
    rt.readings.moisture = Math.round(m);
    rt.readings.ph = round1(clamp(jitter(rt.readings.ph, 0.05), 4, 9));
    rt.readings.ec = round1(clamp(jitter(rt.readings.ec, 0.04), 0, 5));
    rt.readings.n = Math.round(clamp(jitter(rt.readings.n, 1.5), 0, 320));
    rt.readings.p = Math.round(clamp(jitter(rt.readings.p, 1.0), 0, 120));
    rt.readings.k = Math.round(clamp(jitter(rt.readings.k, 1.5), 0, 360));
    rt.readings.soilTemp = round1(clamp(jitter(rt.readings.soilTemp, 0.2), 4, 40));
    rt.readings.airTemp = round1(clamp(jitter(rt.readings.airTemp, 0.25), 0, 45));

    // usage accounting + telemetry history.
    if (rt.valveOpen) rt.litersToday += 0.9;
    pushSample(z.id, 'moisture', rt.readings.moisture);
    pushSample(z.id, 'ph', rt.readings.ph);
    pushSample(z.id, 'ec', rt.readings.ec);
    pushSample(z.id, 'soilTemp', rt.readings.soilTemp);

    // mirror the valve into its actuator (reported state).
    const valveActId = valveByZone[z.id];
    const valveAct = actuators.find((a) => a.id === valveActId);
    if (valveAct) {
      valveAct.state = rt.valveOpen;
      valveAct.mode = z.mode;
      if (valveAct.desired !== null && valveAct.desired === rt.valveOpen) valveAct.desired = null;
    }
  }

  // pump follows "any valve open"; dosing follows EC-below across zones.
  const anyOpen = zones.some((z) => runtime[z.id]?.valveOpen);
  const pump = actuators.find((a) => a.type === 'pump');
  if (pump) pump.state = anyOpen;

  // weather drifts a touch.
  weather = {
    airTemp: round1(clamp(jitter(weather.airTemp, 0.2), 2, 40)),
    humidity: Math.round(clamp(jitter(weather.humidity, 1), 10, 100)),
    pressure: Math.round(clamp(jitter(weather.pressure, 0.6), 980, 1040)),
    rain1h: Math.max(0, round1(jitter(weather.rain1h, 0.2))),
  };
}

let timer: ReturnType<typeof setInterval> | null = null;
/** Start the background virtual gateway (idempotent). */
export function startVirtualGateway(intervalMs = 2000): void {
  if (timer) return;
  // initialise rules + a few history points before the first read.
  for (const z of zones) applyCropRule(z);
  for (let i = 0; i < 30; i++) driftZones();
  timer = setInterval(driftZones, intervalMs);
}
/** Stop the background loop (used in teardown / tests). */
export function stopVirtualGateway(): void {
  if (timer) clearInterval(timer);
  timer = null;
}
startVirtualGateway();

// ---------------------------------------------------------------------------
// derived serializers — readings → analysis, zone → wire shapes
// ---------------------------------------------------------------------------

/** The live engine readings for a zone (the shape analyzeZone consumes). */
export function readingsFor(zoneId: string): ChannelReadings {
  const rt = runtime[zoneId];
  if (!rt) return {};
  return { ...rt.readings };
}

/** Full agronomy analysis for a zone, computed by the shared engine. */
export function analysis(zoneId: string, locale: 'en' | 'ne' = 'en'): ZoneAnalysis {
  const zone = zones.find((z) => z.id === zoneId);
  const crop = zone ? getCrop(zone.cropId ?? '') : undefined;
  if (!zone || !crop || !zone.plantingDate) {
    // unassigned zone → empty analysis.
    return {
      stage: 'germination',
      daysSincePlanting: 0,
      health: { score: 0, perChannel: [] },
      channels: [],
      recommendations: [],
      rule: { moistureLow: 0, moistureHigh: 0, phTarget: 0, ecTarget: 0 },
    };
  }
  return analyzeZone({
    crop,
    plantingDate: zone.plantingDate,
    readings: readingsFor(zoneId),
    locale,
  });
}

/** A crop's flat reference row (the `CropRef` wire shape). */
export function cropRef(crop: Crop): CropRef {
  return {
    id: crop.id,
    nameEn: crop.nameEn,
    nameNe: crop.nameNe,
    emoji: crop.emoji,
    category: crop.category,
    daysToHarvest: crop.daysToHarvest,
    wateringNotesEn: crop.wateringNotesEn,
    wateringNotesNe: crop.wateringNotesNe,
    ideal: crop.ideal,
    acceptable: crop.acceptable,
    createdAt: nowIso(),
  };
}

export const cropRefs: CropRef[] = CROPS.map(cropRef);

// ---------------------------------------------------------------------------
// query / mutation helpers used by client.ts
// ---------------------------------------------------------------------------

export function findUserByEmail(email: string): PublicUser | undefined {
  const e = email.trim().toLowerCase();
  return users.find((u) => u.email.toLowerCase() === e);
}

export function accountById(id: string): Account | undefined {
  return accounts.find((a) => a.id === id);
}

export function entitlementsFor(accountId: string): EntitlementRecord | undefined {
  return entitlements.find((e) => e.accountId === accountId);
}

export function zoneById(zoneId: string): Zone | undefined {
  return zones.find((z) => z.id === zoneId);
}

export function ruleFor(zoneId: string): Rule {
  return rules[zoneId] ?? applyCropRule(zoneById(zoneId)!);
}

export function setZoneMode(zoneId: string, mode: 'auto' | 'manual'): Zone {
  const zone = zoneById(zoneId);
  if (!zone) throw new Error('zone not found');
  zone.mode = mode;
  const valveAct = actuators.find((a) => a.id === valveByZone[zoneId]);
  if (valveAct) valveAct.mode = mode;
  return zone;
}

/** Open/close a zone valve via its actuator command (desired-vs-reported). */
export function commandActuator(actuatorId: string, action: 'open' | 'close' | 'on' | 'off' | 'dose'): { actuator: Actuator; pending: boolean } {
  const act = actuators.find((a) => a.id === actuatorId);
  if (!act) throw new Error('actuator not found');
  const want = action === 'open' || action === 'on' || action === 'dose';

  if (act.type === 'valve' && act.zoneId) {
    const rt = runtime[act.zoneId];
    if (rt) {
      // manual override takes effect immediately at the controller; report lags.
      rt.valveOpen = want;
    }
  }
  act.desired = want;
  // simulate the device confirming after a short delay.
  setTimeout(() => {
    act.state = want;
    if (act.desired === want) act.desired = null;
  }, 700);
  return { actuator: { ...act }, pending: true };
}

/** Resolve the valve actuator id for a zone (so callers can use setValve). */
export function valveActuatorId(zoneId: string): string {
  return valveByZone[zoneId];
}

export function ackAlert(id: string): Alert | undefined {
  const a = alerts.find((x) => x.id === id);
  if (a && !a.acknowledgedAt) a.acknowledgedAt = nowIso();
  return a;
}

export function addHarvest(input: { zoneId: string; cropId?: string; harvestedAt: string; yieldKg?: number; notes?: string }): HarvestLog {
  const zone = zoneById(input.zoneId);
  const log: HarvestLog = {
    id: uid('hv'),
    zoneId: input.zoneId,
    cropId: input.cropId ?? zone?.cropId ?? 'tomato',
    harvestedAt: input.harvestedAt,
    yieldKg: input.yieldKg ?? null,
    notes: input.notes ?? null,
  };
  harvestLog.unshift(log);
  return log;
}

const CHANNEL_DB_MAP_REVERSE: Record<string, Channel> = {
  moisture: 'moisture',
  ph: 'ph',
  ec: 'ec',
  n: 'n',
  p: 'p',
  k: 'k',
  soiltemp: 'soilTemp',
  airtemp: 'airTemp',
};

/** Assign a crop to a zone, (re)derive the rule, and seed sensor channels. */
export function assignZone(
  zoneId: string,
  input: { cropId: string; plantingDate: string; nodeId?: string; channels?: { type: SensorChannel['type']; unit: string; enabled?: boolean }[] },
): { zone: Zone; channels: SensorChannel[]; rule: Rule; analysis: ZoneAnalysis } {
  const zone = zoneById(zoneId);
  if (!zone) throw new Error('zone not found');
  zone.cropId = input.cropId;
  zone.plantingDate = input.plantingDate;
  if (input.nodeId) zone.nodeId = input.nodeId;

  // re-seed runtime readings off the new crop band.
  const startMoisture = runtime[zoneId]?.readings.moisture ?? 50;
  runtime[zoneId] = seedRuntime(zone, startMoisture, runtime[zoneId]?.valveOpen ?? false);

  // sensor channels: replace this zone's set with the requested (or default) ones.
  type ChannelInput = { type: SensorChannel['type']; unit: string; enabled?: boolean };
  const requested: ChannelInput[] = input.channels?.length
    ? input.channels
    : (['moisture', 'ph', 'ec', 'n', 'p', 'k', 'soiltemp'] as SensorChannel['type'][]).map((t) => ({ type: t, unit: '' }));
  for (let i = sensorChannels.length - 1; i >= 0; i--) {
    if (sensorChannels[i].zoneId === zoneId) sensorChannels.splice(i, 1);
  }
  const created: SensorChannel[] = requested.map((c) => ({
    id: `chan_${zoneId}_${c.type}`,
    zoneId,
    farmId: FARM_ID,
    type: c.type,
    unit: c.unit || channelUnit[(CHANNEL_DB_MAP_REVERSE[c.type] ?? 'moisture') as Channel],
    calibration: {},
    enabled: c.enabled ?? true,
  }));
  sensorChannels.push(...created);

  const rule = applyCropRule(zone);
  return { zone: { ...zone }, channels: created, rule, analysis: analysis(zoneId) };
}

// ---------------------------------------------------------------------------
// telemetry + analytics readers
// ---------------------------------------------------------------------------

/** Raw telemetry samples for one zone (all simulated channels). */
export function telemetryRaw(zoneId: string): TelemetrySample[] {
  const out: TelemetrySample[] = [];
  for (const ch of SIM_CHANNELS) {
    const arr = telemetryHistory[`${zoneId}:${ch}`];
    if (arr) out.push(...arr);
  }
  return out.sort((a, b) => a.time.localeCompare(b.time));
}

/** Bucket the raw moisture/ph/ec/soilTemp history into avg/min/max buckets. */
export function telemetryBuckets(zoneId: string, agg: '5m' | '1h' | '1d'): TelemetryBucket[] {
  const size = agg === '5m' ? 5 : agg === '1h' ? 12 : 48; // ticks per bucket (~2s/tick)
  const buckets: TelemetryBucket[] = [];
  for (const ch of ['moisture', 'ph', 'ec', 'soilTemp'] as Channel[]) {
    const arr = telemetryHistory[`${zoneId}:${ch}`] ?? [];
    for (let i = 0; i < arr.length; i += size) {
      const slice = arr.slice(i, i + size);
      if (!slice.length) continue;
      const vals = slice.map((s) => s.value);
      buckets.push({
        bucket: slice[0].time,
        channelId: `chan_${zoneId}_${ch}`,
        zoneId,
        avg: round1(vals.reduce((a, b) => a + b, 0) / vals.length),
        min: Math.min(...vals),
        max: Math.max(...vals),
      });
    }
  }
  return buckets;
}

/** Daily usage buckets for a farm (water + fertilizer). */
export function usageBuckets(farmId: string): UsageBucket[] {
  return usageHistory.filter((u) => u.farmId === farmId);
}

/** Savings vs a fixed-schedule baseline for a farm in the window. */
export function savings(farmId: string): { farmId: string; waterUsedL: number; baselineL: number; savedL: number; savedPct: number } {
  const used = usageHistory
    .filter((u) => u.farmId === farmId && u.kind === 'water_liters')
    .reduce((a, b) => a + b.total, 0);
  const baseline = used * 1.42; // a dumb fixed-timer schedule would over-water ~42%.
  const saved = Math.max(0, baseline - used);
  return {
    farmId,
    waterUsedL: round1(used),
    baselineL: round1(baseline),
    savedL: round1(saved),
    savedPct: baseline > 0 ? Math.round((saved / baseline) * 100) : 0,
  };
}

export function getWeather() {
  return { ...weather };
}

export function getActuators(): Actuator[] {
  return actuators.map((a) => ({ ...a }));
}

export { FARM_ID, CUSTOMER_ACCOUNT_ID, ADMIN_ACCOUNT_ID };
