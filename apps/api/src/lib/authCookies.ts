// Refresh-token cookie + CSRF helpers (browser hardening).
//
// Browser clients keep the refresh token in an httpOnly, SameSite=Lax cookie
// (scoped to /auth) instead of JS-readable storage — so an XSS cannot exfiltrate
// it. SameSite=Lax already blocks the cookie on cross-site POSTs (the main CSRF
// vector); on top of that we use a stateless double-submit CSRF token: a token
// derived as HMAC(refreshToken, CSRF_SECRET), returned in the login/refresh body
// and echoed back as the `X-CSRF-Token` header on /auth/refresh + /auth/logout.
//
// Mobile / non-browser clients send the refresh token in the request body (bearer
// style) and are not cookie/CSRF gated — possession of the token is the auth.

import crypto from 'crypto';
import type { Request, Response } from 'express';
import { REFRESH_TTL } from './jwt';

const REFRESH_COOKIE = 'tn_rt';
const CSRF_SECRET =
  process.env.CSRF_SECRET ?? process.env.JWT_REFRESH_SECRET ?? 'dev-csrf-secret-change-me';
// Set COOKIE_SECURE=true behind TLS (production); off for plain-HTTP local dev.
const COOKIE_SECURE = process.env.COOKIE_SECURE === 'true';

function parseCookies(req: Request): Record<string, string> {
  const header = req.headers.cookie;
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    const k = part.slice(0, i).trim();
    if (k) out[k] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

export function readRefreshCookie(req: Request): string | null {
  return parseCookies(req)[REFRESH_COOKIE] ?? null;
}

export function setRefreshCookie(res: Response, token: string): void {
  res.cookie(REFRESH_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: COOKIE_SECURE,
    path: '/auth',
    maxAge: REFRESH_TTL * 1000,
  });
}

export function clearRefreshCookie(res: Response): void {
  res.clearCookie(REFRESH_COOKIE, {
    httpOnly: true,
    sameSite: 'lax',
    secure: COOKIE_SECURE,
    path: '/auth',
  });
}

/** Stateless CSRF token bound to a refresh token (double-submit, no storage). */
export function csrfFor(refreshToken: string): string {
  return crypto.createHmac('sha256', CSRF_SECRET).update(refreshToken).digest('hex');
}

/** Constant-time compare of a presented CSRF header against the expected value. */
export function csrfValid(refreshToken: string, headerToken: string | undefined): boolean {
  if (!headerToken) return false;
  const expected = Buffer.from(csrfFor(refreshToken));
  const got = Buffer.from(headerToken);
  return expected.length === got.length && crypto.timingSafeEqual(expected, got);
}

/** Whether the caller is a browser/web client (declared header or a refresh cookie present). */
export function isWebClient(req: Request): boolean {
  return req.get('x-client') === 'web' || readRefreshCookie(req) !== null;
}
