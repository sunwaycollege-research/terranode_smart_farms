import { DEVICE_CATALOG, EntitlementKey } from './deviceCatalog';
import type { Role } from '../types/models';

/**
 * A farmer's entitlements: which modular devices/features are switched ON.
 * Numeric for `count` device classes (e.g. zoneNodes: 4), boolean for toggles.
 *
 * BUSINESS RULE (from the brief):
 *   - The RETAILER sets these ONCE, at farmer-account creation.
 *   - After creation the retailer can NO LONGER edit them (locked).
 *   - Only COMPANY (company_admin) can edit a locked entitlement set afterwards,
 *     "based on what the farmer wants".
 */
export type Entitlements = Partial<Record<EntitlementKey, number | boolean>>;

export interface EntitlementRecord {
  accountId: string; // the farmer account these belong to
  values: Entitlements;
  locked: boolean; // true once the farmer account is created
  setByUserId: string;
  setByRole: Role;
  updatedAt: string;
}

/** Default entitlement set used to pre-fill the create-customer form. */
export function defaultEntitlements(): Entitlements {
  const out: Entitlements = {};
  for (const d of DEVICE_CATALOG) out[d.key] = d.default;
  return out;
}

export function isEnabled(e: Entitlements | undefined, key: EntitlementKey): boolean {
  if (!e) return false;
  const v = e[key];
  if (typeof v === 'number') return v > 0;
  return Boolean(v);
}

export function countOf(e: Entitlements | undefined, key: EntitlementKey): number {
  const v = e?.[key];
  return typeof v === 'number' ? v : v ? 1 : 0;
}

/**
 * Can `role` edit entitlements for an already-created (locked) farmer?
 * Retailers: NO once locked. Company: always YES. This is the core guardrail.
 */
export function canEditEntitlements(role: Role, record: EntitlementRecord | undefined): boolean {
  if (role === 'company_admin') return true;
  if (role === 'retailer_admin') return !(record?.locked ?? true);
  return false;
}
