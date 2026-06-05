// @teranode/types — WebSocket message types for `WS /live?token=JWT`.
// Client → server: subscribe/unsubscribe/ping. Server → client: telemetry,
// health, state (actuator), alert, cmd-ack, plus pong/error/subscribed.
// These mirror the Redis pub/sub channels the ingest worker fans out.

import type { AlertSeverity } from './enums';
import type { Alert, UUID } from './entities';
import type { ZoneAnalysis } from './agronomy';

/** What a client can subscribe to. */
export type SubscribeTarget =
  | { farmId: UUID; zoneId?: undefined }
  | { zoneId: UUID; farmId?: undefined };

// --- client → server ----------------------------------------------------------

export interface WsSubscribeMessage {
  type: 'subscribe';
  /** `{farmId}` to follow a whole farm, or `{zoneId}` for one zone. */
  subscribe: SubscribeTarget;
}

export interface WsUnsubscribeMessage {
  type: 'unsubscribe';
  unsubscribe: SubscribeTarget;
}

export interface WsPingMessage {
  type: 'ping';
  t?: number;
}

export type WsClientMessage =
  | WsSubscribeMessage
  | WsUnsubscribeMessage
  | WsPingMessage;

// --- server → client ----------------------------------------------------------

/** Live telemetry tick for one channel of a zone. */
export interface WsTelemetryMessage {
  type: 'telemetry';
  farmId: UUID;
  zoneId: UUID | null;
  channelId: UUID;
  /** Engine channel name when resolvable (e.g. `moisture`). */
  channel?: string;
  value: number;
  ts: string;
}

/** Live zone-health/analysis push (recomputed after new telemetry). */
export interface WsHealthMessage {
  type: 'health';
  farmId: UUID;
  zoneId: UUID;
  analysis: ZoneAnalysis;
}

/** Actuator state change (reported and desired). */
export interface WsStateMessage {
  type: 'state';
  farmId: UUID;
  zoneId: UUID | null;
  actuatorId: UUID;
  state: boolean;
  desired: boolean | null;
  ts: string;
}

/** Command acknowledgement (desired-vs-reported reconciled). */
export interface WsCmdAckMessage {
  type: 'cmd';
  farmId: UUID;
  zoneId: UUID | null;
  actuatorId: UUID;
  accepted: boolean;
  ts: string;
}

/** A new/updated alert pushed to subscribers. */
export interface WsAlertMessage {
  type: 'alert';
  farmId: UUID | null;
  zoneId: UUID | null;
  severity: AlertSeverity;
  alert: Alert;
}

/** Confirmation that a subscribe/unsubscribe was applied. */
export interface WsSubscribedMessage {
  type: 'subscribed';
  target: SubscribeTarget;
  active: boolean;
}

export interface WsPongMessage {
  type: 'pong';
  t?: number;
}

export interface WsErrorMessage {
  type: 'error';
  error: string;
}

export type WsServerMessage =
  | WsTelemetryMessage
  | WsHealthMessage
  | WsStateMessage
  | WsCmdAckMessage
  | WsAlertMessage
  | WsSubscribedMessage
  | WsPongMessage
  | WsErrorMessage;

/** Any message that can travel over the live socket. */
export type WsMessage = WsClientMessage | WsServerMessage;

// --- Redis pub/sub payloads (ingest → api fan-out) ---------------------------

/** Channel naming helpers used by both ingest (publisher) and api (subscriber). */
export const REDIS_FARM_CHANNEL = (farmId: UUID): string => `live:farm:${farmId}`;
export const REDIS_ZONE_CHANNEL = (zoneId: UUID): string => `live:zone:${zoneId}`;

/** The JSON payload published on a Redis live channel = a server message. */
export type RedisLivePayload = WsServerMessage;
