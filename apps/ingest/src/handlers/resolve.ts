// Resolve a device-id-first topic (`teranode/dev/{serial}/...`) to its cloud
// addressing: { accountId, farmId, gatewayId } + the farm's ordered zone ids.
//
// The device knows only its own serial; the binding (which customer/farm it
// belongs to, created at claim + first-boot provisioning) lives in the DB. We
// cache the lookup briefly so steady-state telemetry doesn't hit Postgres per
// message, while a freshly-provisioned device still resolves within a few seconds.

import { query } from '../db';

export interface DeviceRoute {
  accountId: string;
  farmId: string;
  gatewayId: string;
  zoneIds: string[]; // ordered by zone creation, for local-index → uuid mapping
}

const TTL_MS = 15_000;
const cache = new Map<string, { route: DeviceRoute | null; at: number }>();

/** Resolve a device serial → route, or null if unknown / not yet provisioned. */
export async function resolveDevice(serial: string): Promise<DeviceRoute | null> {
  const now = Date.now();
  const hit = cache.get(serial);
  if (hit && now - hit.at < TTL_MS) return hit.route;

  const gw = await query<{ gateway_id: string; account_id: string | null; farm_id: string | null }>(
    `SELECT id AS gateway_id, account_id, farm_id FROM gateways WHERE serial = $1 LIMIT 1`,
    [serial],
  );
  const g = gw[0];

  let route: DeviceRoute | null = null;
  if (g && g.account_id && g.farm_id) {
    const zones = await query<{ id: string }>(
      `SELECT id FROM zones WHERE farm_id = $1 ORDER BY created_at ASC`,
      [g.farm_id],
    );
    route = {
      accountId: g.account_id,
      farmId: g.farm_id,
      gatewayId: g.gateway_id,
      zoneIds: zones.map((z) => z.id),
    };
  }
  cache.set(serial, { route, at: now });
  return route;
}

/** Drop a serial from the cache (e.g. after re-provisioning changes its farm). */
export function invalidateDevice(serial: string): void {
  cache.delete(serial);
}
