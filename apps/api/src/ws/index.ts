// WebSocket live fan-out for `WS /live?token=JWT` (spec §5, unit 4.3).
//
// On `attachWebsocket(server)` we mount a `ws` server on the `/live` path of the
// existing HTTP server and:
//   1. authenticate each upgrade by verifying the `?token=<JWT>` access token
//      (bad/absent token → the socket is accepted then closed with code 4401 so
//      browser clients get a clear application close reason rather than a raw
//      handshake failure);
//   2. accept `{subscribe|unsubscribe: {farmId?|zoneId?}}` and `{ping}` client
//      messages, authorizing each subscription against the connection's account
//      (customer → only its own farms/zones; admin → everything);
//   3. fan out the matching `live:farm:{id}` / `live:zone:{id}` Redis messages
//      the ingest worker publishes (a single shared ioredis *subscriber* built
//      from REDIS_URL pattern-subscribes to `live:*` and dispatches locally).
//
// Every forwarded payload is re-checked against the connection's allowed-farm
// set by its `farmId`, so even a buggy/over-broad subscription can never leak
// another tenant's data. Subscriptions are cleaned up on socket close.

import 'dotenv/config';
import type { IncomingMessage, Server as HttpServer } from 'http';
import type { Socket } from 'net';
import Redis from 'ioredis';
import { WebSocketServer, type WebSocket } from 'ws';
import type {
  JwtClaims,
  RedisLivePayload,
  SubscribeTarget,
  UUID,
  WsClientMessage,
  WsServerMessage,
} from '@teranode/types';
import { REDIS_FARM_CHANNEL, REDIS_ZONE_CHANNEL } from '@teranode/types';
import { verifyAccessToken } from '../lib/jwt';
import { pool } from '../db/client';

const REDIS_URL = process.env.REDIS_URL ?? 'redis://localhost:6379';

/** Application close code for a failed/expired token (RFC 6455 private range). */
const CLOSE_AUTH_FAILED = 4401;

// --- per-connection state ----------------------------------------------------

interface LiveConn {
  ws: WebSocket;
  claims: JwtClaims;
  /** Redis channel keys this socket is currently subscribed to. */
  channels: Set<string>;
  /**
   * Farm ids this connection is allowed to see (customer scope). `null` for an
   * admin (allowed to see every farm). Lazily resolved + cached per connection.
   */
  allowedFarms: Set<UUID> | null;
}

/** channelKey → set of connections interested in it (local dispatch index). */
const subscribers = new Map<string, Set<LiveConn>>();

// --- shared Redis subscriber (one per process) -------------------------------

let sub: Redis | null = null;

/** Lazily build the shared subscriber and start pattern-listening on `live:*`. */
function getSubscriber(): Redis {
  if (sub) return sub;
  const s = new Redis(REDIS_URL, {
    lazyConnect: false,
    // A subscriber connection cannot serve normal commands; keep it dedicated.
    maxRetriesPerRequest: null,
  });
  s.on('error', (err) => {
    console.error('[ws-redis]', err.message);
  });
  s.on('pmessage', (_pattern: string, channel: string, message: string) => {
    dispatch(channel, message);
  });
  // Single pattern subscription covers every live:farm:* / live:zone:* channel,
  // so we never churn (P)SUBSCRIBE as individual sockets come and go.
  s.psubscribe('live:*').catch((err) => {
    console.error('[ws-redis] psubscribe failed:', (err as Error).message);
  });
  sub = s;
  return s;
}

/** Forward one Redis message to every authorized local subscriber of `channel`. */
function dispatch(channel: string, message: string): void {
  const conns = subscribers.get(channel);
  if (!conns || conns.size === 0) return;

  let payload: RedisLivePayload;
  try {
    payload = JSON.parse(message) as RedisLivePayload;
  } catch {
    return; // ignore malformed publishes
  }

  for (const conn of conns) {
    if (!isAllowed(conn, payload)) continue;
    send(conn.ws, payload);
  }
}

/**
 * Authorization gate applied to every forwarded payload. Admins see all.
 * Customers may only receive payloads whose `farmId` is one of their farms.
 * Payloads without a usable `farmId` (shouldn't reach here over a live channel)
 * are dropped for non-admins.
 */
function isAllowed(conn: LiveConn, payload: WsServerMessage): boolean {
  if (conn.claims.accountType === 'admin') return true; // sees every farm
  const farmId = 'farmId' in payload ? payload.farmId : undefined;
  if (!farmId) return false;
  // A customer always has its farm set resolved before any local subscription
  // exists (authorizeTarget → loadAllowedFarms runs first); guard anyway.
  return conn.allowedFarms?.has(farmId as UUID) ?? false;
}

// --- authorization helpers (DB-backed, cached per connection) ----------------

/** Resolve + cache the set of farm ids a customer connection may see. */
async function loadAllowedFarms(conn: LiveConn): Promise<Set<UUID>> {
  if (conn.allowedFarms) return conn.allowedFarms;
  const res = await pool.query<{ id: UUID }>(
    `SELECT id FROM farms WHERE account_id = $1`,
    [conn.claims.accountId],
  );
  const set = new Set<UUID>(res.rows.map((r) => r.id));
  conn.allowedFarms = set;
  return set;
}

/**
 * Decide whether `conn` may subscribe to `target` and return the Redis channel
 * key to (un)subscribe locally, or null if not authorized / not resolvable.
 *  - farm target → must be one of the connection's allowed farms (admins: any).
 *  - zone target → resolve the zone's farm, then apply the same farm check.
 */
async function authorizeTarget(
  conn: LiveConn,
  target: SubscribeTarget,
): Promise<{ channel: string; farmId: UUID } | null> {
  const isAdmin = conn.claims.accountType === 'admin';

  if (target.farmId) {
    const farmId = target.farmId as UUID;
    if (isAdmin) return { channel: REDIS_FARM_CHANNEL(farmId), farmId };
    const allowed = await loadAllowedFarms(conn);
    return allowed.has(farmId) ? { channel: REDIS_FARM_CHANNEL(farmId), farmId } : null;
  }

  if (target.zoneId) {
    const zoneId = target.zoneId as UUID;
    const res = await pool.query<{ farm_id: UUID }>(
      `SELECT farm_id FROM zones WHERE id = $1`,
      [zoneId],
    );
    const farmId = res.rows[0]?.farm_id;
    if (!farmId) return null; // unknown zone
    if (!isAdmin) {
      const allowed = await loadAllowedFarms(conn);
      if (!allowed.has(farmId)) return null;
    }
    return { channel: REDIS_ZONE_CHANNEL(zoneId), farmId };
  }

  return null;
}

// --- local subscription index helpers ----------------------------------------

function addLocalSub(conn: LiveConn, channel: string): void {
  if (conn.channels.has(channel)) return;
  conn.channels.add(channel);
  let set = subscribers.get(channel);
  if (!set) {
    set = new Set();
    subscribers.set(channel, set);
  }
  set.add(conn);
}

function removeLocalSub(conn: LiveConn, channel: string): void {
  if (!conn.channels.delete(channel)) return;
  const set = subscribers.get(channel);
  if (!set) return;
  set.delete(conn);
  if (set.size === 0) subscribers.delete(channel);
}

function cleanupConn(conn: LiveConn): void {
  for (const channel of conn.channels) {
    const set = subscribers.get(channel);
    if (set) {
      set.delete(conn);
      if (set.size === 0) subscribers.delete(channel);
    }
  }
  conn.channels.clear();
}

// --- send helper --------------------------------------------------------------

function send(ws: WebSocket, msg: WsServerMessage): void {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
}

// --- server entrypoint --------------------------------------------------------

/** Attach the `/live` WebSocket server to an existing HTTP server. */
export function attachWebsocket(server: HttpServer): WebSocketServer {
  // Bring the shared subscriber up so it is listening before any client joins.
  getSubscriber();

  // noServer: we own the HTTP `upgrade` so we can gate on path + authenticate
  // the token before completing (or rejecting) the handshake.
  const wss = new WebSocketServer({ noServer: true });

  server.on('upgrade', (req: IncomingMessage, socket: Socket, head: Buffer) => {
    let url: URL;
    try {
      url = new URL(req.url ?? '', 'http://localhost');
    } catch {
      socket.destroy();
      return;
    }
    if (url.pathname !== '/live') {
      socket.destroy();
      return;
    }

    // Verify the token. We complete the handshake either way so we can send a
    // structured 4401 application close to bad tokens (clearer for browsers).
    let claims: JwtClaims | null = null;
    try {
      const token = url.searchParams.get('token');
      if (token) claims = verifyAccessToken(token);
    } catch {
      claims = null;
    }

    wss.handleUpgrade(req, socket, head, (ws) => {
      if (!claims) {
        ws.close(CLOSE_AUTH_FAILED, 'invalid or expired token');
        return;
      }
      wss.emit('connection', ws, req, claims);
    });
  });

  wss.on('connection', (ws: WebSocket, _req: IncomingMessage, claims: JwtClaims) => {
    // `allowedFarms` is the admin "see-all" sentinel only when the account is an
    // admin; for a customer it starts null and is resolved+cached on first
    // authorize/forward (so isAllowed/authorizeTarget gate on accountType, not
    // on the null itself).
    const conn: LiveConn = {
      ws,
      claims,
      channels: new Set(),
      allowedFarms: null,
    };

    ws.on('message', (raw) => {
      let msg: WsClientMessage;
      try {
        msg = JSON.parse(raw.toString()) as WsClientMessage;
      } catch {
        send(ws, { type: 'error', error: 'invalid JSON' });
        return;
      }

      switch (msg.type) {
        case 'ping':
          send(ws, { type: 'pong', t: msg.t });
          break;

        case 'subscribe':
          void handleSubscribe(conn, msg.subscribe);
          break;

        case 'unsubscribe':
          void handleUnsubscribe(conn, msg.unsubscribe);
          break;

        default:
          send(ws, { type: 'error', error: 'unknown message type' });
      }
    });

    ws.on('close', () => cleanupConn(conn));
    ws.on('error', () => {
      // A broken socket should not crash the server; ensure we still unwire it.
      cleanupConn(conn);
    });
  });

  return wss;
}

// --- subscribe / unsubscribe handlers ----------------------------------------

async function handleSubscribe(conn: LiveConn, target: SubscribeTarget): Promise<void> {
  let auth: { channel: string; farmId: UUID } | null = null;
  try {
    auth = await authorizeTarget(conn, target);
  } catch (err) {
    console.error('[ws] subscribe authorize failed:', (err as Error).message);
    send(conn.ws, { type: 'error', error: 'subscription failed' });
    return;
  }
  if (!auth) {
    // Not authorized / unresolvable target → ack as inactive (no data leak).
    send(conn.ws, { type: 'subscribed', target, active: false });
    return;
  }
  addLocalSub(conn, auth.channel);
  send(conn.ws, { type: 'subscribed', target, active: true });
}

async function handleUnsubscribe(conn: LiveConn, target: SubscribeTarget): Promise<void> {
  // Compute the same channel key the subscribe would have used. We don't need a
  // DB hit here for farm targets; zone targets unsubscribe by their own key.
  let channel: string | null = null;
  if (target.farmId) channel = REDIS_FARM_CHANNEL(target.farmId as UUID);
  else if (target.zoneId) channel = REDIS_ZONE_CHANNEL(target.zoneId as UUID);

  if (channel) removeLocalSub(conn, channel);
  send(conn.ws, { type: 'subscribed', target, active: false });
}
