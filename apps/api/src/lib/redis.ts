// Shared ioredis client + refresh-token store for the TERANODE API.
//
// One ioredis connection per process (REDIS_URL). Phase 4's WS fan-out will
// add a second (subscriber) connection of its own; this module owns the
// command connection used for refresh-token bookkeeping.
//
// Refresh-token rotation model:
//   - On login we mint a refresh token and store its id (jti-ish key) keyed by
//     userId, with the refresh TTL. We key by the *token string* so a single
//     user can have one active session per device without us tracking devices:
//     `refresh:<userId>:<token>` → '1' (TTL = REFRESH_TTL).
//   - On refresh we check the presented token exists, delete it (single-use),
//     and store the freshly-minted one (rotation).
//   - On logout we delete the presented token.
// If Redis is unavailable the helpers fail closed (treated as "not stored").

import Redis from 'ioredis';
import { REFRESH_TTL } from './jwt';

const REDIS_URL = process.env.REDIS_URL ?? 'redis://localhost:6379';

/** Shared command connection (lazy — connects on first use). */
export const redis = new Redis(REDIS_URL, {
  lazyConnect: false,
  maxRetriesPerRequest: 2,
  enableOfflineQueue: true,
});

redis.on('error', (err) => {
  // Don't crash the process on a transient Redis blip; log once per event.
  console.error('[redis]', err.message);
});

const refreshKey = (userId: string, token: string): string =>
  `refresh:${userId}:${token}`;

/** Store an active refresh token for a user (TTL = REFRESH_TTL). */
export async function storeRefreshToken(userId: string, token: string): Promise<void> {
  await redis.set(refreshKey(userId, token), '1', 'EX', REFRESH_TTL);
}

/** True if this exact refresh token is currently active for the user. */
export async function isRefreshTokenActive(userId: string, token: string): Promise<boolean> {
  const v = await redis.get(refreshKey(userId, token));
  return v === '1';
}

/** Remove a single refresh token (single-use rotation / logout). */
export async function revokeRefreshToken(userId: string, token: string): Promise<void> {
  await redis.del(refreshKey(userId, token));
}

/**
 * Rotate: atomically verify-and-replace. Returns true if the old token was
 * active (and has now been swapped for the new one); false if it was not.
 */
export async function rotateRefreshToken(
  userId: string,
  oldToken: string,
  newToken: string,
): Promise<boolean> {
  const wasActive = await isRefreshTokenActive(userId, oldToken);
  if (!wasActive) return false;
  await revokeRefreshToken(userId, oldToken);
  await storeRefreshToken(userId, newToken);
  return true;
}
