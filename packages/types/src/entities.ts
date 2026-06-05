// @teranode/types — entity interfaces (the API-serialized shape of each DB row).
// Timestamps/dates are ISO strings over the wire. numeric/jsonb columns are typed
// to their logical TS shape.

import type {
  AccountStatus,
  AccountType,
  ActuatorScope,
  ActuatorType,
  AlertSeverity,
  ChannelType,
  ComputeKind,
  ControlMode,
  DeviceCatalogCategory,
  DeviceCatalogKind,
  GatewayStatus,
  RuleSource,
  UserRole,
} from './enums';
import type { CropBand, CropCategory, GrowthStage } from './agronomy';

/** ISO-8601 timestamp string (e.g. `2026-05-29T10:00:00.000Z`). */
export type ISODateTime = string;
/** ISO date string (e.g. `2026-05-29`). */
export type ISODate = string;
/** UUID v4 string. */
export type UUID = string;

/** Arbitrary GeoJSON-ish blob stored in jsonb columns. */
export type GeoJson = Record<string, unknown>;

// --- accounts & users ---------------------------------------------------------

export interface Account {
  id: UUID;
  type: AccountType;
  name: string;
  parentId: UUID | null;
  status: AccountStatus;
  plan: string | null;
  locale: string;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
}

export interface User {
  id: UUID;
  accountId: UUID;
  email: string;
  name: string;
  role: UserRole;
  /** Optional per-user locale override (falls back to the account locale). */
  locale: string | null;
  createdAt: ISODateTime;
}

/** A user as returned by the API — never includes `password_hash`. */
export type PublicUser = User;

// --- crops (DB reference rows) ------------------------------------------------

/**
 * The `crops` row as stored/served. The rich agronomy `Crop` type (with parsed
 * `stages[]`) lives in `agronomy.ts`; this is the flat DB-reference shape.
 */
export interface CropRef {
  id: string;
  nameEn: string;
  nameNe: string;
  emoji: string;
  category: CropCategory;
  daysToHarvest: number;
  wateringNotesEn: string | null;
  wateringNotesNe: string | null;
  ideal: CropBand;
  acceptable: CropBand;
  createdAt: ISODateTime;
}

/** The `crop_stages` row as stored/served. */
export interface CropStageRow {
  id: string;
  cropId: string;
  stage: GrowthStage;
  ordinal: number;
  startDay: number;
  ideal: CropBand;
  acceptable: CropBand;
}

// --- farms, gateways, nodes, zones, channels ----------------------------------

export interface Farm {
  id: UUID;
  accountId: UUID;
  name: string;
  timezone: string;
  geo: GeoJson | null;
  createdAt: ISODateTime;
}

export interface Gateway {
  id: UUID;
  serial: string;
  farmId: UUID | null;
  accountId: UUID | null;
  compute: ComputeKind;
  model: string | null; // SKU / hardware model
  fwVersion: string;
  status: GatewayStatus;
  claimedAt: ISODateTime | null; // when linked to a customer
  provisionedAt: ISODateTime | null; // first successful boot/auto-link
  wifiSsid: string | null; // last known WiFi network
  lastSeen: ISODateTime | null;
  createdAt: ISODateTime;
}

export interface Node {
  id: UUID;
  gatewayId: UUID;
  radioAddr: string | null;
  battery: number | null;
  lastSeen: ISODateTime | null;
  createdAt: ISODateTime;
}

export interface Zone {
  id: UUID;
  farmId: UUID;
  name: string;
  cropId: string | null;
  plantingDate: ISODate | null;
  areaM2: number | null;
  nodeId: UUID | null;
  mode: ControlMode;
  createdAt: ISODateTime;
}

export interface SensorChannel {
  id: UUID;
  zoneId: UUID | null;
  farmId: UUID | null;
  type: ChannelType;
  unit: string;
  calibration: Record<string, unknown>;
  enabled: boolean;
}

// --- rules, schedules, dosing, actuators --------------------------------------

export interface Rule {
  zoneId: UUID;
  moistureLow: number;
  moistureHigh: number;
  rainSkipMm: number;
  phTarget: number | null;
  ecTarget: number | null;
  source: RuleSource;
  appliedStage: string | null;
  updatedAt: ISODateTime;
}

export interface Schedule {
  id: UUID;
  farmId: UUID;
  windowStartHour: number;
  windowEndHour: number;
  et0Aware: boolean;
  maxRunMin: number;
  enabled: boolean;
}

/** One dosing pump within a farm's dosing profile (`dosing_profiles.pumps` jsonb). */
export interface DosingPump {
  id: string;
  label: string;
  nutrient: string;
  mlPerL: number;
  enabled: boolean;
}

export interface DosingProfile {
  farmId: UUID;
  ecTarget: number;
  phTarget: number;
  pumps: DosingPump[];
}

export interface Actuator {
  id: UUID;
  scope: ActuatorScope;
  zoneId: UUID | null;
  farmId: UUID | null;
  type: ActuatorType;
  /** Reported state. */
  state: boolean;
  /** Desired state (set by a command, cleared once reported matches). */
  desired: boolean | null;
  mode: ControlMode;
}

// --- telemetry & usage --------------------------------------------------------

/** A raw telemetry sample. */
export interface TelemetrySample {
  time: ISODateTime;
  channelId: UUID;
  zoneId: UUID | null;
  farmId: UUID | null;
  value: number;
  quality: number;
}

/** A rolled-up telemetry bucket (5m/1h/1d continuous aggregate). */
export interface TelemetryBucket {
  bucket: ISODateTime;
  channelId: UUID;
  zoneId: UUID | null;
  avg: number;
  min: number;
  max: number;
}

/** A usage event (water/fertilizer accounting). */
export interface UsageEvent {
  time: ISODateTime;
  farmId: UUID;
  zoneId: UUID | null;
  kind: string;
  value: number;
}

/** A rolled-up daily usage bucket. */
export interface UsageBucket {
  bucket: ISODate;
  farmId: UUID;
  zoneId: UUID | null;
  kind: string;
  total: number;
}

// --- alerts, harvest, audit, entitlements, catalog ----------------------------

export interface Alert {
  id: UUID;
  accountId: UUID;
  farmId: UUID | null;
  zoneId: UUID | null;
  severity: AlertSeverity;
  type: string;
  messageEn: string;
  messageNe: string | null;
  ts: ISODateTime;
  acknowledgedAt: ISODateTime | null;
}

export interface HarvestLog {
  id: UUID;
  zoneId: UUID;
  cropId: string;
  harvestedAt: ISODate;
  yieldKg: number | null;
  notes: string | null;
}

export interface AuditEntry {
  id: UUID;
  actorId: UUID;
  accountId: UUID | null;
  action: string;
  target: string | null;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  ts: ISODateTime;
}

/** A single value in an entitlement record (count or toggle). */
export type EntitlementValue = number | boolean;

/** Map of device-catalog key → entitlement value. */
export type Entitlements = Record<string, EntitlementValue>;

export interface EntitlementRecord {
  accountId: UUID;
  values: Entitlements;
  updatedBy: UUID | null;
  updatedAt: ISODateTime;
}

export interface DeviceCatalogItem {
  key: string;
  label: string;
  category: DeviceCatalogCategory;
  kind: DeviceCatalogKind;
  defaultValue: EntitlementValue;
  hint: string | null;
  gatesDashboard: boolean;
}
