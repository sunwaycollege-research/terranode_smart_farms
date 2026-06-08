// @teranode/types — enums (mirror the Postgres ENUM types in the DB schema).
// All values are string-literal unions so they are usable in both type and value position.

/** accounts.type — the single admin root vs. customer (farmer) accounts. */
export type AccountType = 'admin' | 'customer';

/** accounts.status */
export type AccountStatus = 'active' | 'disabled';

/** users.role — kept extensible in the DB enum, but only these two are used now. */
export type UserRole = 'admin' | 'customer';

/** gateways.compute — the on-prem compute board kind. */
export type ComputeKind = 'esp32' | 'rpi4';

/** gateways.status — device lifecycle: registered (unbound) → claimed → online/offline (+revoked). */
export type GatewayStatus =
  | 'online'
  | 'offline'
  | 'unbound' // registered/flashed, in stock, not yet sold
  | 'claimed' // linked to a customer account, not yet booted
  | 'revoked'; // returned / RMA / disabled

/** sensor_channels.type — the raw DB channel enum (note: snake/short names). */
export type ChannelType =
  | 'moisture'
  | 'ph'
  | 'ec'
  | 'n'
  | 'p'
  | 'k'
  | 'soiltemp'
  | 'airtemp'
  | 'humidity'
  | 'pressure'
  | 'rain'
  | 'flow'; // YF-S201 flow meter (L/min) — leak detection + usage metering

/** alerts.severity */
export type AlertSeverity = 'info' | 'warn' | 'critical';

/** actuators.scope — whether the actuator belongs to a zone or the whole farm. */
export type ActuatorScope = 'zone' | 'farm';

/** actuators.type */
export type ActuatorType = 'valve' | 'pump' | 'dosing';

/** zones.mode / actuators.mode — automatic control vs. manual override. */
export type ControlMode = 'auto' | 'manual';

/** rules.source — whether the rule came from the crop band or was hand-edited. */
export type RuleSource = 'crop' | 'manual';

/** device_catalog.kind — how an entitlement value is rendered/edited. */
export type DeviceCatalogKind = 'count' | 'toggle';

/** device_catalog.category */
export type DeviceCatalogCategory = 'sensing' | 'actuation' | 'platform';

// Convenient runtime arrays (handy for validation / select options). -----------

export const ACCOUNT_TYPES: readonly AccountType[] = ['admin', 'customer'];
export const ACCOUNT_STATUSES: readonly AccountStatus[] = ['active', 'disabled'];
export const USER_ROLES: readonly UserRole[] = ['admin', 'customer'];
export const COMPUTE_KINDS: readonly ComputeKind[] = ['esp32', 'rpi4'];
export const GATEWAY_STATUSES: readonly GatewayStatus[] = [
  'online',
  'offline',
  'unbound',
  'claimed',
  'revoked',
];
export const CHANNEL_TYPES: readonly ChannelType[] = [
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
];
export const ALERT_SEVERITIES: readonly AlertSeverity[] = ['info', 'warn', 'critical'];
export const ACTUATOR_SCOPES: readonly ActuatorScope[] = ['zone', 'farm'];
export const ACTUATOR_TYPES: readonly ActuatorType[] = ['valve', 'pump', 'dosing'];
export const CONTROL_MODES: readonly ControlMode[] = ['auto', 'manual'];
export const RULE_SOURCES: readonly RuleSource[] = ['crop', 'manual'];
