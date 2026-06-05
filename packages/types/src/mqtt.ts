// @teranode/types — MQTT topic vocabulary shared by the ingest worker and the
// virtual gateway (spec §5). Topic shape:
//   teranode/{accountId}/{farmId}/{gatewayId}/{kind}/...
// kinds: telemetry (per zone), weather (per farm), health, state, cmd.

import type { UUID } from './entities';

/** Root namespace prefix for all TERANODE MQTT topics. */
export const MQTT_ROOT = 'teranode';

/** The message kinds carried over MQTT. */
export type MqttKind = 'telemetry' | 'weather' | 'health' | 'state' | 'cmd';

/** Per-zone telemetry topic. */
export const telemetryTopic = (
  accountId: UUID,
  farmId: UUID,
  gatewayId: UUID,
  zoneId: UUID,
): string =>
  `${MQTT_ROOT}/${accountId}/${farmId}/${gatewayId}/telemetry/zone/${zoneId}`;

/** Per-farm weather telemetry topic. */
export const weatherTopic = (
  accountId: UUID,
  farmId: UUID,
  gatewayId: UUID,
): string => `${MQTT_ROOT}/${accountId}/${farmId}/${gatewayId}/weather`;

/** Gateway health/LWT topic. */
export const healthTopic = (
  accountId: UUID,
  farmId: UUID,
  gatewayId: UUID,
): string => `${MQTT_ROOT}/${accountId}/${farmId}/${gatewayId}/health`;

/** Actuator state-report topic. */
export const stateTopic = (
  accountId: UUID,
  farmId: UUID,
  gatewayId: UUID,
): string => `${MQTT_ROOT}/${accountId}/${farmId}/${gatewayId}/state`;

/** Command topic (server → gateway). */
export const cmdTopic = (
  accountId: UUID,
  farmId: UUID,
  gatewayId: UUID,
): string => `${MQTT_ROOT}/${accountId}/${farmId}/${gatewayId}/cmd`;

/** Wildcard subscription that matches every TERANODE message. */
export const MQTT_WILDCARD = `${MQTT_ROOT}/#`;

// --- payload shapes -----------------------------------------------------------

/** One channel reading inside a telemetry payload. */
export interface MqttChannelReading {
  /** Raw DB channel type, e.g. `moisture`, `soiltemp`. */
  channel: string;
  value: number;
  quality?: number;
}

/** Payload published on a telemetry topic. */
export interface MqttTelemetryPayload {
  ts: string;
  zoneId: UUID;
  readings: MqttChannelReading[];
}

/** Payload published on a weather topic. */
export interface MqttWeatherPayload {
  ts: string;
  readings: MqttChannelReading[];
}

/** Payload published on a health/LWT topic. */
export interface MqttHealthPayload {
  ts: string;
  status: 'online' | 'offline';
  fwVersion?: string;
  battery?: number;
}

/** Payload published on a state topic (actuator report). */
export interface MqttStatePayload {
  ts: string;
  actuators: Array<{
    actuatorId: UUID;
    zoneId?: UUID;
    state: boolean;
  }>;
  /** Optional usage tick (liters) emitted while a valve is open. */
  usage?: Array<{ zoneId?: UUID; kind: string; value: number }>;
}

/** Payload published on a cmd topic (server → gateway). */
export interface MqttCmdPayload {
  ts: string;
  actuatorId: UUID;
  zoneId?: UUID;
  action: 'open' | 'close' | 'on' | 'off' | 'dose';
  volumeMl?: number;
}
