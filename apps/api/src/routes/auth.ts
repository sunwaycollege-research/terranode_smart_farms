// Real auth routes — password login + rotating refresh tokens (spec §5).
//
//   POST /auth/login    { email, password } → access + refresh + user + account
//   POST /auth/refresh  { refreshToken }     → rotated access + refresh
//   POST /auth/logout   { refreshToken }     → { ok: true }
//   GET  /me                                  → { user, account }   (auth required)
//   GET  /me/entitlements                     → { accountId, values, catalog }
//
// Access JWT carries {userId, accountId, accountType, role}; the active refresh
// token is tracked in Redis and rotated single-use on every /auth/refresh.

import { Router, type Request, type Response, type NextFunction } from 'express';
import bcrypt from 'bcryptjs';
import { eq } from 'drizzle-orm';
import type {
  Account,
  DeviceCatalogItem,
  Entitlements,
  EntitlementsResponse,
  LoginResponse,
  LogoutResponse,
  MeResponse,
  PublicUser,
  RefreshResponse,
} from '@teranode/types';
import { DEVICE_CATALOG, defaultEntitlements } from '@teranode/types';
import { db, schema } from '../db/client';
import {
  signAccessToken,
  signRefreshToken,
  verifyRefreshToken,
  ACCESS_TTL,
  bareClaims,
  type ClaimsInput,
} from '../lib/jwt';
import {
  storeRefreshToken,
  rotateRefreshToken,
  revokeRefreshToken,
} from '../lib/redis';
import { HttpError } from '../middleware/error';
import { requireAuth } from '../middleware/auth';
import {
  readRefreshCookie,
  setRefreshCookie,
  clearRefreshCookie,
  csrfFor,
  csrfValid,
  isWebClient,
} from '../lib/authCookies';

/** Read a string refreshToken from the request body, if present. */
function bodyRefreshToken(req: Request): string | undefined {
  const v = (req.body ?? {}).refreshToken;
  return typeof v === 'string' && v ? v : undefined;
}

export const authRouter = Router();

// --- serializers (DB row → wire entity) --------------------------------------

type UserRow = typeof schema.users.$inferSelect;
type AccountRow = typeof schema.accounts.$inferSelect;

function toPublicUser(u: UserRow): PublicUser {
  return {
    id: u.id,
    accountId: u.accountId,
    email: u.email,
    name: u.name,
    role: u.role,
    locale: u.locale ?? null,
    createdAt: u.createdAt.toISOString(),
  };
}

function toAccount(a: AccountRow): Account {
  return {
    id: a.id,
    type: a.type,
    name: a.name,
    parentId: a.parentId ?? null,
    status: a.status,
    plan: a.plan ?? null,
    locale: a.locale,
    createdAt: a.createdAt.toISOString(),
    updatedAt: a.updatedAt.toISOString(),
  };
}

/** Small async-handler wrapper so thrown errors reach the error middleware. */
function wrap(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<void>,
): (req: Request, res: Response, next: NextFunction) => void {
  return (req, res, next) => {
    fn(req, res, next).catch(next);
  };
}

async function loadUser(userId: string): Promise<UserRow | undefined> {
  const rows = await db.select().from(schema.users).where(eq(schema.users.id, userId)).limit(1);
  return rows[0];
}

async function loadAccount(accountId: string): Promise<AccountRow | undefined> {
  const rows = await db
    .select()
    .from(schema.accounts)
    .where(eq(schema.accounts.id, accountId))
    .limit(1);
  return rows[0];
}

// --- POST /auth/login --------------------------------------------------------

authRouter.post(
  '/login',
  wrap(async (req, res) => {
    const { email, password } = (req.body ?? {}) as { email?: unknown; password?: unknown };
    if (typeof email !== 'string' || typeof password !== 'string' || !email || !password) {
      throw new HttpError(400, 'email and password are required');
    }

    const userRows = await db
      .select()
      .from(schema.users)
      .where(eq(schema.users.email, email))
      .limit(1);
    const user = userRows[0];
    // Always compare against a hash (even when no user) to keep timing uniform.
    const hash = user?.passwordHash ?? '$2a$10$invalidinvalidinvalidinvalidinvalidinvalidinvalidinva';
    const ok = await bcrypt.compare(password, hash);
    if (!user || !ok) throw new HttpError(401, 'invalid credentials');

    const account = await loadAccount(user.accountId);
    if (!account) throw new HttpError(500, 'account not found for user');
    if (account.status === 'disabled') throw new HttpError(403, 'account disabled');

    const claims: ClaimsInput = {
      userId: user.id,
      accountId: account.id,
      accountType: account.type,
      role: user.role,
    };
    const accessToken = signAccessToken(claims);
    const refreshToken = signRefreshToken(claims);
    await storeRefreshToken(user.id, refreshToken);

    // Browsers: refresh token goes into an httpOnly cookie + a CSRF token in the
    // body. Mobile/non-browser: refresh token in the body (bearer style).
    const web = isWebClient(req);
    if (web) setRefreshCookie(res, refreshToken);

    const body: LoginResponse = {
      accessToken,
      expiresIn: ACCESS_TTL,
      user: toPublicUser(user),
      account: toAccount(account),
      csrfToken: csrfFor(refreshToken),
      ...(web ? {} : { refreshToken }),
    };
    res.json(body);
  }),
);

// --- POST /auth/refresh ------------------------------------------------------

authRouter.post(
  '/refresh',
  wrap(async (req, res) => {
    // Prefer the httpOnly cookie (browser); fall back to the body (mobile).
    const cookieToken = readRefreshCookie(req);
    const refreshToken = cookieToken ?? bodyRefreshToken(req);
    if (!refreshToken) throw new HttpError(400, 'refresh token is required');

    // The cookie (browser) path must present a matching CSRF token.
    if (cookieToken && !csrfValid(cookieToken, req.get('x-csrf-token') ?? undefined)) {
      throw new HttpError(403, 'invalid or missing CSRF token');
    }

    let claims;
    try {
      claims = verifyRefreshToken(refreshToken);
    } catch {
      throw new HttpError(401, 'invalid or expired refresh token');
    }

    const next: ClaimsInput = bareClaims(claims);
    const newAccess = signAccessToken(next);
    const newRefresh = signRefreshToken(next);

    const rotated = await rotateRefreshToken(claims.userId, refreshToken, newRefresh);
    if (!rotated) throw new HttpError(401, 'refresh token not recognized');

    const web = Boolean(cookieToken) || isWebClient(req);
    if (web) setRefreshCookie(res, newRefresh);

    const body: RefreshResponse = {
      accessToken: newAccess,
      expiresIn: ACCESS_TTL,
      csrfToken: csrfFor(newRefresh),
      ...(web ? {} : { refreshToken: newRefresh }),
    };
    res.json(body);
  }),
);

// --- POST /auth/logout -------------------------------------------------------

authRouter.post(
  '/logout',
  wrap(async (req, res) => {
    const token = readRefreshCookie(req) ?? bodyRefreshToken(req);
    if (token) {
      try {
        const claims = verifyRefreshToken(token);
        await revokeRefreshToken(claims.userId, token);
      } catch {
        // Already invalid/expired — logout is idempotent, treat as success.
      }
    }
    clearRefreshCookie(res);
    const body: LogoutResponse = { ok: true };
    res.json(body);
  }),
);

// --- GET /me -----------------------------------------------------------------

authRouter.get(
  '/me',
  requireAuth,
  wrap(async (req, res) => {
    const auth = req.auth!;
    const user = await loadUser(auth.userId);
    const account = await loadAccount(auth.accountId);
    if (!user || !account) throw new HttpError(404, 'user not found');
    const body: MeResponse = {
      user: toPublicUser(user),
      account: toAccount(account),
    };
    res.json(body);
  }),
);

// --- GET /me/entitlements ----------------------------------------------------

authRouter.get(
  '/me/entitlements',
  requireAuth,
  wrap(async (req, res) => {
    const auth = req.auth!;
    const rows = await db
      .select()
      .from(schema.entitlementRecords)
      .where(eq(schema.entitlementRecords.accountId, auth.accountId))
      .limit(1);

    const values: Entitlements = rows[0]?.values ?? defaultEntitlements();
    const catalog: DeviceCatalogItem[] = [...DEVICE_CATALOG];
    const body: EntitlementsResponse = {
      accountId: auth.accountId,
      values,
      catalog,
    };
    res.json(body);
  }),
);
