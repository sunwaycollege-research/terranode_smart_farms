// JWT sign/verify for the TERANODE API.
//
// Two token kinds:
//  - access  — short-lived (~15m), carries the full JwtClaims; sent on every
//    request as `Authorization: Bearer <token>` and verified by requireAuth.
//  - refresh — long-lived (~30d), opaque-ish bearer used only at /auth/refresh.
//    The refresh token also carries the claims so a rotation can re-mint an
//    access token without a DB hit, but its validity is gated by Redis (the
//    server stores/rotates the active refresh token per user — see ./redis).
//
// Secrets + TTLs come from env (see root .env.example):
//   JWT_ACCESS_SECRET, JWT_REFRESH_SECRET, JWT_ACCESS_TTL, JWT_REFRESH_TTL.

import jwt from 'jsonwebtoken';
import type { JwtClaims } from '@teranode/types';

const ACCESS_SECRET = process.env.JWT_ACCESS_SECRET ?? 'dev-access-secret-change-me';
const REFRESH_SECRET = process.env.JWT_REFRESH_SECRET ?? 'dev-refresh-secret-change-me';

/** Access-token lifetime in seconds (default 15 minutes). */
export const ACCESS_TTL = Number(process.env.JWT_ACCESS_TTL ?? 900);
/** Refresh-token lifetime in seconds (default 30 days). */
export const REFRESH_TTL = Number(process.env.JWT_REFRESH_TTL ?? 2_592_000);

/** The subset of claims callers pass in (iat/exp are added by jsonwebtoken). */
export type ClaimsInput = Omit<JwtClaims, 'iat' | 'exp'>;

/** Sign a short-lived access token. */
export function signAccessToken(claims: ClaimsInput): string {
  return jwt.sign(claims, ACCESS_SECRET, { expiresIn: ACCESS_TTL });
}

/** Sign a long-lived refresh token. */
export function signRefreshToken(claims: ClaimsInput): string {
  return jwt.sign(claims, REFRESH_SECRET, { expiresIn: REFRESH_TTL });
}

/**
 * Verify an access token. Throws (JsonWebTokenError/TokenExpiredError) on any
 * problem; returns the decoded claims on success.
 */
export function verifyAccessToken(token: string): JwtClaims {
  return jwt.verify(token, ACCESS_SECRET) as JwtClaims;
}

/** Verify a refresh token. Throws on any problem; returns decoded claims. */
export function verifyRefreshToken(token: string): JwtClaims {
  return jwt.verify(token, REFRESH_SECRET) as JwtClaims;
}

/** Strip jwt-internal fields, leaving the bare claim payload. */
export function bareClaims(claims: JwtClaims): ClaimsInput {
  return {
    userId: claims.userId,
    accountId: claims.accountId,
    accountType: claims.accountType,
    role: claims.role,
  };
}
