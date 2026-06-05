// Gateway liveness tracking + offline alerting.
//
// Every ingested message (telemetry, weather, health, state) marks its gateway
// "seen". A periodic watchdog scans the seen-map and, when a gateway has gone
// quiet past OFFLINE_AFTER_MS (or an explicit offline LWT/state arrives), it:
//   - updates gateways.status='offline'
//   - inserts an alerts row (type 'gateway_offline') for the owning account
//   - publishes a WsAlertMessage to Redis so the API can fan it out
// It de-dupes: one offline alert per offline transition (re-arms once the
// gateway comes back online).

import type Redis from 'ioredis';
import type { Alert } from '@teranode/types';
import { query } from '../db';
import { publishLive } from './publish';

/** Mark a gateway offline after this much silence (default 3 ticks @ 2s ≈ 6s,
 *  but we use a comfortable 30s so a slow virtual gateway is not flagged). */
const OFFLINE_AFTER_MS = Number(process.env.GATEWAY_OFFLINE_MS ?? 30_000);
const SWEEP_INTERVAL_MS = Number(process.env.GATEWAY_SWEEP_MS ?? 10_000);

interface GatewaySeen {
  gatewayId: string;
  accountId?: string;
  farmId?: string;
  lastSeen: number;
  /** true once we've emitted an offline alert for the current outage. */
  offlineAlerted: boolean;
}

const seen = new Map<string, GatewaySeen>();

/** Note that a gateway produced traffic now (re-arms offline alerting). */
export function markSeen(
  gatewayId: string | undefined,
  accountId?: string,
  farmId?: string,
): void {
  if (!gatewayId) return;
  const prev = seen.get(gatewayId);
  seen.set(gatewayId, {
    gatewayId,
    accountId: accountId ?? prev?.accountId,
    farmId: farmId ?? prev?.farmId,
    lastSeen: Date.now(),
    offlineAlerted: false,
  });
}

/** Resolve a gateway's account_id + farm_id from the DB (for alert ownership). */
async function resolveGatewayOwner(
  gatewayId: string,
): Promise<{ accountId: string | null; farmId: string | null } | null> {
  const rows = await query<{ account_id: string | null; farm_id: string | null }>(
    `SELECT account_id, farm_id FROM gateways WHERE id = $1 LIMIT 1`,
    [gatewayId],
  );
  if (!rows[0]) return null;
  return { accountId: rows[0].account_id, farmId: rows[0].farm_id };
}

/**
 * Transition a gateway to offline: flip status, insert a de-duped alert, and
 * fan out over Redis. Safe to call multiple times — the entry's `offlineAlerted`
 * flag guards repeat alerts until the gateway is seen again.
 */
export async function markOffline(
  redis: Redis,
  gatewayId: string,
  hint?: { accountId?: string; farmId?: string },
): Promise<void> {
  const entry = seen.get(gatewayId);
  if (entry?.offlineAlerted) return; // already alerted this outage

  // resolve owner (prefer hint → entry → DB)
  let accountId = hint?.accountId ?? entry?.accountId ?? null;
  let farmId = hint?.farmId ?? entry?.farmId ?? null;
  if (!accountId || !farmId) {
    const owner = await resolveGatewayOwner(gatewayId);
    accountId = accountId ?? owner?.accountId ?? null;
    farmId = farmId ?? owner?.farmId ?? null;
  }

  await query(
    `UPDATE gateways SET status = 'offline' WHERE id = $1`,
    [gatewayId],
  );

  // Without an owning account we can't attach a tenant-scoped alert; still mark
  // the status + flag so we don't spin.
  if (entry) entry.offlineAlerted = true;
  if (!accountId) return;

  const serialRows = await query<{ serial: string }>(
    `SELECT serial FROM gateways WHERE id = $1 LIMIT 1`,
    [gatewayId],
  );
  const serial = serialRows[0]?.serial ?? gatewayId;

  const inserted = await query<{
    id: string;
    ts: Date;
  }>(
    `INSERT INTO alerts
       (account_id, farm_id, zone_id, severity, type, message_en, message_ne)
     VALUES ($1,$2,NULL,'critical','gateway_offline',$3,$4)
     RETURNING id, ts`,
    [
      accountId,
      farmId,
      `Gateway ${serial} went offline (no telemetry).`,
      `गेटवे ${serial} अफलाइन भयो (कुनै टेलिमेट्री छैन)।`,
    ],
  );
  const row = inserted[0];
  if (!row) return;

  const alert: Alert = {
    id: row.id,
    accountId,
    farmId,
    zoneId: null,
    severity: 'critical',
    type: 'gateway_offline',
    messageEn: `Gateway ${serial} went offline (no telemetry).`,
    messageNe: `गेटवे ${serial} अफलाइन भयो (कुनै टेलिमेट्री छैन)।`,
    ts: (row.ts instanceof Date ? row.ts : new Date(row.ts)).toISOString(),
    acknowledgedAt: null,
  };

  await publishLive(redis, {
    type: 'alert',
    farmId,
    zoneId: null,
    severity: 'critical',
    alert,
  });

  console.log(`[ingest][liveness] gateway ${serial} → offline (alert ${row.id})`);
}

/** Mark a gateway online again in the DB (e.g. health 'online' or first traffic). */
export async function markOnline(gatewayId: string): Promise<void> {
  await query(
    `UPDATE gateways SET status = 'online', last_seen = now() WHERE id = $1`,
    [gatewayId],
  );
}

let sweepTimer: NodeJS.Timeout | null = null;

/** Start the periodic offline watchdog. Returns a stop function. */
export function startLivenessWatchdog(redis: Redis): () => void {
  sweepTimer = setInterval(() => {
    const now = Date.now();
    for (const entry of seen.values()) {
      if (entry.offlineAlerted) continue;
      if (now - entry.lastSeen > OFFLINE_AFTER_MS) {
        void markOffline(redis, entry.gatewayId, {
          accountId: entry.accountId,
          farmId: entry.farmId,
        }).catch((err) =>
          console.error('[ingest][liveness] sweep error:', (err as Error).message),
        );
      }
    }
  }, SWEEP_INTERVAL_MS);
  // don't keep the event loop alive solely for the sweep
  sweepTimer.unref?.();
  return () => {
    if (sweepTimer) clearInterval(sweepTimer);
    sweepTimer = null;
  };
}
