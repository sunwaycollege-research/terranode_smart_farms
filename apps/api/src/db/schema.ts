// Drizzle ORM (pg-core) schema for the TERANODE Postgres/TimescaleDB database.
//
// This mirrors the DDL in BUILD-SPEC §2 column-for-column (exact column names and
// types). It is the *typed-query* surface used by the API services; the actual DDL
// (extensions, enums, hypertables, continuous aggregates, retention/compression
// policies) is applied by the raw-SQL idempotent migration in `./migrate`.
//
// Notes:
//  - `citext` has no first-class drizzle column type, so we model it with a small
//    `customType` that maps to the `citext` SQL type (the migration creates the
//    extension). It behaves like `text` on the JS side.
//  - jsonb columns are typed via `.$type<...>()` so service code gets the logical
//    shape from @teranode/types / @teranode/agronomy.

import { sql } from 'drizzle-orm';
import {
  boolean,
  customType,
  date,
  doublePrecision,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  smallint,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import type {
  CropBand,
  Entitlements,
  GeoJson,
} from '@teranode/types';
import type { DosingPump } from '@teranode/types';

/** case-insensitive text — backed by the `citext` extension type. */
const citext = customType<{ data: string; driver: string }>({
  dataType() {
    return 'citext';
  },
});

// --- enums (mirror the Postgres ENUM types) ----------------------------------

export const accountTypeEnum = pgEnum('account_type', ['admin', 'customer']);
export const accountStatusEnum = pgEnum('account_status', ['active', 'disabled']);
export const userRoleEnum = pgEnum('user_role', ['admin', 'customer']);
export const computeKindEnum = pgEnum('compute_kind', ['esp32', 'rpi4']);
export const gwStatusEnum = pgEnum('gw_status', [
  'online',
  'offline',
  'unbound', // registered/flashed, in stock, not yet sold
  'claimed', // linked to a customer account at purchase, not yet booted
  'revoked', // returned / RMA / disabled
]);
export const channelTypeEnum = pgEnum('channel_type', [
  'moisture',
  'ph',
  'ec',
  'n',
  'p',
  'k',
  'soiltemp',
  'airtemp',
  'humidity',
  'pressure',
  'rain',
  'flow',
]);
export const alertSevEnum = pgEnum('alert_sev', ['info', 'warn', 'critical']);
export const actuatorScopeEnum = pgEnum('actuator_scope', ['zone', 'farm']);
export const actuatorTypeEnum = pgEnum('actuator_type', ['valve', 'pump', 'dosing']);

// --- accounts & users --------------------------------------------------------

export const accounts = pgTable('accounts', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  type: accountTypeEnum('type').notNull(),
  name: text('name').notNull(),
  parentId: uuid('parent_id').references((): any => accounts.id),
  status: accountStatusEnum('status').notNull().default('active'),
  plan: text('plan'),
  locale: text('locale').notNull().default('en'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const users = pgTable('users', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  accountId: uuid('account_id')
    .notNull()
    .references(() => accounts.id),
  email: citext('email').notNull().unique(),
  name: text('name').notNull(),
  role: userRoleEnum('role').notNull(),
  passwordHash: text('password_hash').notNull(),
  locale: text('locale'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// --- crops & growth stages ---------------------------------------------------

export const crops = pgTable('crops', {
  id: text('id').primaryKey(), // slug
  nameEn: text('name_en').notNull(),
  nameNe: text('name_ne').notNull(),
  emoji: text('emoji').notNull(),
  category: text('category').notNull(),
  daysToHarvest: integer('days_to_harvest').notNull(),
  wateringNotesEn: text('watering_notes_en'),
  wateringNotesNe: text('watering_notes_ne'),
  ideal: jsonb('ideal').$type<CropBand>().notNull(),
  acceptable: jsonb('acceptable').$type<CropBand>().notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const cropStages = pgTable(
  'crop_stages',
  {
    id: text('id').primaryKey(), // 'tomato:flowering'
    cropId: text('crop_id')
      .notNull()
      .references(() => crops.id),
    stage: text('stage').notNull(),
    ordinal: integer('ordinal').notNull(),
    startDay: integer('start_day').notNull(),
    ideal: jsonb('ideal').$type<CropBand>().notNull(),
    acceptable: jsonb('acceptable').$type<CropBand>().notNull(),
  },
  (t) => ({
    cropStageUq: unique('crop_stages_crop_stage_uq').on(t.cropId, t.stage),
  }),
);

// --- farms, gateways, nodes, zones, channels ---------------------------------

export const farms = pgTable('farms', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  accountId: uuid('account_id')
    .notNull()
    .references(() => accounts.id),
  name: text('name').notNull(),
  timezone: text('timezone').notNull().default('Asia/Kathmandu'),
  geo: jsonb('geo').$type<GeoJson>(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const gateways = pgTable('gateways', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  serial: text('serial').notNull().unique(),
  farmId: uuid('farm_id').references(() => farms.id),
  accountId: uuid('account_id').references(() => accounts.id),
  compute: computeKindEnum('compute').notNull().default('esp32'),
  model: text('model'), // SKU / hardware model, e.g. 'TN-BRAIN-3Z'
  fwVersion: text('fw_version').notNull().default('0.0.0'),
  status: gwStatusEnum('status').notNull().default('unbound'),
  claimedAt: timestamp('claimed_at', { withTimezone: true }), // linked to a customer
  provisionedAt: timestamp('provisioned_at', { withTimezone: true }), // first successful boot
  wifiSsid: text('wifi_ssid'), // last known WiFi network (set during onboarding)
  lastSeen: timestamp('last_seen', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const nodes = pgTable('nodes', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  gatewayId: uuid('gateway_id')
    .notNull()
    .references(() => gateways.id),
  radioAddr: text('radio_addr'),
  battery: integer('battery'),
  lastSeen: timestamp('last_seen', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const zones = pgTable('zones', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  farmId: uuid('farm_id')
    .notNull()
    .references(() => farms.id),
  name: text('name').notNull(),
  cropId: text('crop_id').references(() => crops.id),
  plantingDate: date('planting_date'),
  areaM2: numeric('area_m2'),
  nodeId: uuid('node_id').references(() => nodes.id),
  mode: text('mode').notNull().default('auto'), // auto|manual
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const sensorChannels = pgTable('sensor_channels', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  zoneId: uuid('zone_id').references(() => zones.id),
  farmId: uuid('farm_id').references(() => farms.id),
  type: channelTypeEnum('type').notNull(),
  unit: text('unit').notNull(),
  calibration: jsonb('calibration')
    .$type<Record<string, unknown>>()
    .notNull()
    .default(sql`'{}'::jsonb`),
  enabled: boolean('enabled').notNull().default(true),
});

export const deviceTokens = pgTable('device_tokens', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  gatewayId: uuid('gateway_id')
    .notNull()
    .references(() => gateways.id),
  secretHash: text('secret_hash').notNull(),
  revoked: boolean('revoked').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// --- rules, schedules, dosing, actuators -------------------------------------

export const rules = pgTable('rules', {
  zoneId: uuid('zone_id')
    .primaryKey()
    .references(() => zones.id),
  moistureLow: numeric('moisture_low').notNull(),
  moistureHigh: numeric('moisture_high').notNull(),
  rainSkipMm: numeric('rain_skip_mm').notNull().default('4'),
  phTarget: numeric('ph_target'),
  ecTarget: numeric('ec_target'),
  source: text('source').notNull().default('crop'), // crop|manual
  appliedStage: text('applied_stage'),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const schedules = pgTable('schedules', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  farmId: uuid('farm_id')
    .notNull()
    .references(() => farms.id),
  windowStartHour: integer('window_start_hour').notNull().default(5),
  windowEndHour: integer('window_end_hour').notNull().default(19),
  et0Aware: boolean('et0_aware').notNull().default(true),
  maxRunMin: integer('max_run_min').notNull().default(90),
  enabled: boolean('enabled').notNull().default(true),
});

export const dosingProfiles = pgTable('dosing_profiles', {
  farmId: uuid('farm_id')
    .primaryKey()
    .references(() => farms.id),
  ecTarget: numeric('ec_target').notNull(),
  phTarget: numeric('ph_target').notNull(),
  pumps: jsonb('pumps')
    .$type<DosingPump[]>()
    .notNull()
    .default(sql`'[]'::jsonb`),
});

export const actuators = pgTable('actuators', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  scope: actuatorScopeEnum('scope').notNull(),
  zoneId: uuid('zone_id').references(() => zones.id),
  farmId: uuid('farm_id').references(() => farms.id),
  type: actuatorTypeEnum('type').notNull(),
  state: boolean('state').notNull().default(false),
  desired: boolean('desired'),
  mode: text('mode').notNull().default('auto'),
});

// --- telemetry + usage (Timescale hypertables) -------------------------------

export const telemetry = pgTable(
  'telemetry',
  {
    time: timestamp('time', { withTimezone: true }).notNull(),
    channelId: uuid('channel_id')
      .notNull()
      .references(() => sensorChannels.id),
    zoneId: uuid('zone_id'),
    farmId: uuid('farm_id'),
    value: doublePrecision('value').notNull(),
    quality: smallint('quality').notNull().default(1),
  },
  (t) => ({
    channelTime: index('telemetry_channel_time').on(t.channelId, t.time.desc()),
    zoneTime: index('telemetry_zone_time').on(t.zoneId, t.time.desc()),
  }),
);

export const usageEvents = pgTable('usage_events', {
  time: timestamp('time', { withTimezone: true }).notNull(),
  farmId: uuid('farm_id').notNull(),
  zoneId: uuid('zone_id'),
  kind: text('kind').notNull(),
  value: doublePrecision('value').notNull(),
});

// --- alerts, harvest, audit, entitlements, catalog ---------------------------

export const alerts = pgTable('alerts', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  accountId: uuid('account_id')
    .notNull()
    .references(() => accounts.id),
  farmId: uuid('farm_id').references(() => farms.id),
  zoneId: uuid('zone_id').references(() => zones.id),
  severity: alertSevEnum('severity').notNull(),
  type: text('type').notNull(),
  messageEn: text('message_en').notNull(),
  messageNe: text('message_ne'),
  ts: timestamp('ts', { withTimezone: true }).notNull().defaultNow(),
  acknowledgedAt: timestamp('acknowledged_at', { withTimezone: true }),
});

export const harvestLog = pgTable('harvest_log', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  zoneId: uuid('zone_id')
    .notNull()
    .references(() => zones.id),
  cropId: text('crop_id')
    .notNull()
    .references(() => crops.id),
  harvestedAt: date('harvested_at').notNull(),
  yieldKg: numeric('yield_kg'),
  notes: text('notes'),
});

export const auditLog = pgTable('audit_log', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  actorId: uuid('actor_id')
    .notNull()
    .references(() => users.id),
  accountId: uuid('account_id'),
  action: text('action').notNull(),
  target: text('target'),
  before: jsonb('before').$type<Record<string, unknown>>(),
  after: jsonb('after').$type<Record<string, unknown>>(),
  ts: timestamp('ts', { withTimezone: true }).notNull().defaultNow(),
});

export const deviceCatalog = pgTable('device_catalog', {
  key: text('key').primaryKey(),
  label: text('label').notNull(),
  category: text('category').notNull(),
  kind: text('kind').notNull(),
  defaultValue: jsonb('default_value').$type<number | boolean>().notNull(),
  hint: text('hint'),
  gatesDashboard: boolean('gates_dashboard').notNull().default(false),
});

export const entitlementRecords = pgTable('entitlement_records', {
  accountId: uuid('account_id')
    .primaryKey()
    .references(() => accounts.id),
  values: jsonb('values').$type<Entitlements>().notNull(),
  updatedBy: uuid('updated_by').references(() => users.id),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// --- full schema object (handy for the drizzle client / kit) -----------------

export const schema = {
  accounts,
  users,
  crops,
  cropStages,
  farms,
  gateways,
  nodes,
  zones,
  sensorChannels,
  deviceTokens,
  rules,
  schedules,
  dosingProfiles,
  actuators,
  telemetry,
  usageEvents,
  alerts,
  harvestLog,
  auditLog,
  deviceCatalog,
  entitlementRecords,
};
