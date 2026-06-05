// Server-side entitlement enforcement.
//
// The app hides un-entitled features in the UI; this makes the API the source of
// truth so a disabled feature is *denied* (403) even if a client calls it directly.
// Run AFTER requireAuth (and scopeToCustomer where a customer scope applies).
//
//   requireEntitlement('analytics')  → 403 unless the caller's account has it on.
//
// Admins are never feature-gated.

import type { RequestHandler } from 'express';
import { HttpError } from './error';
import { getEntitlementValues } from '../services/entitlements';

/** True when an entitlement value is "on" (count > 0, or a truthy toggle). */
export function entitlementEnabled(value: number | boolean | undefined): boolean {
  return typeof value === 'number' ? value > 0 : Boolean(value);
}

/** Gate a route on a device-catalog entitlement key for the caller's account. */
export function requireEntitlement(key: string): RequestHandler {
  return (req, _res, next) => {
    const auth = req.auth;
    if (!auth) {
      next(new HttpError(401, 'not authenticated'));
      return;
    }
    // Admins operate above the per-customer entitlement gates.
    if (auth.accountType === 'admin') {
      next();
      return;
    }
    const accountId = req.scope?.accountId ?? auth.accountId;
    getEntitlementValues(accountId)
      .then((values) => {
        if (entitlementEnabled(values[key])) {
          next();
        } else {
          next(new HttpError(403, `feature not enabled: ${key}`));
        }
      })
      .catch(next);
  };
}
