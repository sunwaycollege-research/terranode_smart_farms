// Redis fan-out — the ingest worker normalizes each ingested event into a
// WsServerMessage and publishes it to the per-farm and per-zone live channels.
// The API WS bridge (unit 4.3) subscribes to these and forwards to sockets.

import type Redis from 'ioredis';
import {
  REDIS_FARM_CHANNEL,
  REDIS_ZONE_CHANNEL,
  type WsServerMessage,
} from '@teranode/types';

/**
 * Publish a normalized live message to the relevant Redis channels.
 *  - always to `live:farm:{farmId}` when a farmId is present
 *  - additionally to `live:zone:{zoneId}` when a zoneId is present
 * A zone subscriber and a farm subscriber will both see a zone-scoped event.
 */
export async function publishLive(
  redis: Redis,
  msg: WsServerMessage,
): Promise<void> {
  const payload = JSON.stringify(msg);
  const farmId = 'farmId' in msg ? msg.farmId : null;
  const zoneId = 'zoneId' in msg ? msg.zoneId : null;

  const ops: Promise<unknown>[] = [];
  if (farmId) ops.push(redis.publish(REDIS_FARM_CHANNEL(farmId), payload));
  if (zoneId) ops.push(redis.publish(REDIS_ZONE_CHANNEL(zoneId), payload));
  if (ops.length === 0) return;
  await Promise.all(ops);
}
