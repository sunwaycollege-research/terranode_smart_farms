// Auth middleware for the TERANODE API (2-role model).
//
//   requireAuth      — verify the Bearer access JWT, attach `req.auth`.
//   requireAdmin     — requireAuth + assert role === 'admin'.
//   scopeToCustomer  — resolve the tenant boundary: an admin can target any
//                      account (via ?accountId / body.accountId / param),
//                      a customer is hard-scoped to its own account_id.
//
// `req.auth` carries the decoded JwtClaims {userId, accountId, accountType,
// role}. `req.scope` (set by scopeToCustomer) carries the effective accountId
// a handler should read/write under, plus whether the caller is an admin.

import type { NextFunction, Request, RequestHandler, Response } from 'express';
import type { JwtClaims, UUID } from '@teranode/types';
import { verifyAccessToken } from '../lib/jwt';
import { HttpError } from './error';

/** The effective tenant scope a handler operates under. */
export interface RequestScope {
  /** The account_id rows must belong to (admin may override per-request). */
  accountId: UUID;
  /** True when the caller is the admin root (cross-tenant allowed). */
  isAdmin: boolean;
}

// Augment Express' Request so handlers get typed `req.auth` / `req.scope`.
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      auth?: JwtClaims;
      scope?: RequestScope;
    }
  }
}

/** Pull a Bearer token from the Authorization header (or `?token=` for WS-ish callers). */
function extractToken(req: Request): string | null {
  const header = req.headers.authorization;
  if (header && header.startsWith('Bearer ')) return header.slice('Bearer '.length).trim();
  const q = req.query.token;
  if (typeof q === 'string' && q.length > 0) return q;
  return null;
}

/** Verify the access JWT and attach `req.auth`. 401 on any problem. */
export const requireAuth: RequestHandler = (req: Request, _res: Response, next: NextFunction) => {
  const token = extractToken(req);
  if (!token) {
    next(new HttpError(401, 'missing bearer token'));
    return;
  }
  try {
    req.auth = verifyAccessToken(token);
    next();
  } catch {
    next(new HttpError(401, 'invalid or expired token'));
  }
};

/** requireAuth + admin role assertion. */
export const requireAdmin: RequestHandler = (req: Request, res: Response, next: NextFunction) => {
  requireAuth(req, res, (err?: unknown) => {
    if (err) {
      next(err);
      return;
    }
    if (req.auth?.role !== 'admin') {
      next(new HttpError(403, 'admin access required'));
      return;
    }
    next();
  });
};

/**
 * Resolve the tenant scope for a request. Run AFTER requireAuth.
 *  - customer → scope locked to their own account_id; any attempt to target a
 *    different account is a 403.
 *  - admin → scope defaults to the admin account but may be retargeted to any
 *    customer via ?accountId, body.accountId, or req.params.accountId.
 */
export const scopeToCustomer: RequestHandler = (
  req: Request,
  _res: Response,
  next: NextFunction,
) => {
  const auth = req.auth;
  if (!auth) {
    next(new HttpError(401, 'not authenticated'));
    return;
  }

  const requested =
    (typeof req.query.accountId === 'string' && req.query.accountId) ||
    (req.body && typeof req.body.accountId === 'string' && req.body.accountId) ||
    (typeof req.params.accountId === 'string' && req.params.accountId) ||
    null;

  if (auth.accountType === 'admin') {
    req.scope = { accountId: (requested as UUID) ?? auth.accountId, isAdmin: true };
    next();
    return;
  }

  // Customer: hard-scope to own account; reject cross-tenant targeting.
  if (requested && requested !== auth.accountId) {
    next(new HttpError(403, 'cannot access another account'));
    return;
  }
  req.scope = { accountId: auth.accountId, isAdmin: false };
  next();
};
