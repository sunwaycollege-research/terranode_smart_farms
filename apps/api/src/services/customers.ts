// Customers + fleet service (unit 3.1).
//
// Admin-facing operations over the tenant graph:
//   - customers: list / create (account + owner user + default entitlements) /
//     get / update (rename, enable/disable, plan, locale).
//   - fleet & gateways: list all gateways with status + bound farm/customer,
//     register a serial (→ unbound gateway + hashed device token), bind to a
//     farm, and record an OTA firmware target.
//
// The admin root account is the parent of every customer; we resolve it lazily.

import bcrypt from 'bcryptjs';
import { nanoid } from 'nanoid';
import { and, asc, eq, isNull } from 'drizzle-orm';
import type {
  Account,
  AccountStatus,
  AdminFarm,
  ComputeKind,
  CustomerWithEntitlements,
  Entitlements,
  Farm,
  FleetGateway,
  Gateway,
  Node,
  PublicUser,
  UUID,
} from '@teranode/types';
import { db, schema } from '../db/client';
import { HttpError } from '../middleware/error';
import { sendWelcomeEmail } from '../lib/email';
import {
  getEntitlementValues,
  normalizeEntitlements,
  seedEntitlements,
} from './entitlements';

// --- serializers (DB row → wire entity) --------------------------------------

type AccountRow = typeof schema.accounts.$inferSelect;
type UserRow = typeof schema.users.$inferSelect;
type FarmRow = typeof schema.farms.$inferSelect;
type GatewayRow = typeof schema.gateways.$inferSelect;
type NodeRow = typeof schema.nodes.$inferSelect;

export function toAccount(a: AccountRow): Account {
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

export function toPublicUser(u: UserRow): PublicUser {
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

export function toFarm(f: FarmRow): Farm {
  return {
    id: f.id,
    accountId: f.accountId,
    name: f.name,
    timezone: f.timezone,
    geo: f.geo ?? null,
    createdAt: f.createdAt.toISOString(),
  };
}

export function toGateway(g: GatewayRow): Gateway {
  return {
    id: g.id,
    serial: g.serial,
    farmId: g.farmId ?? null,
    accountId: g.accountId ?? null,
    compute: g.compute,
    model: g.model ?? null,
    fwVersion: g.fwVersion,
    status: g.status,
    claimedAt: g.claimedAt ? g.claimedAt.toISOString() : null,
    provisionedAt: g.provisionedAt ? g.provisionedAt.toISOString() : null,
    wifiSsid: g.wifiSsid ?? null,
    lastSeen: g.lastSeen ? g.lastSeen.toISOString() : null,
    createdAt: g.createdAt.toISOString(),
  };
}

export function toNode(n: NodeRow): Node {
  return {
    id: n.id,
    gatewayId: n.gatewayId,
    radioAddr: n.radioAddr ?? null,
    battery: n.battery ?? null,
    lastSeen: n.lastSeen ? n.lastSeen.toISOString() : null,
    createdAt: n.createdAt.toISOString(),
  };
}

// --- admin root resolution ---------------------------------------------------

/** Resolve the single admin-root account id (parent of every customer). */
export async function getAdminRootId(): Promise<UUID> {
  const rows = await db
    .select({ id: schema.accounts.id })
    .from(schema.accounts)
    .where(and(eq(schema.accounts.type, 'admin'), isNull(schema.accounts.parentId)))
    .orderBy(asc(schema.accounts.createdAt))
    .limit(1);
  if (!rows[0]) throw new HttpError(500, 'admin root account not found');
  return rows[0].id;
}

// --- customers ---------------------------------------------------------------

async function loadCustomerAccount(id: UUID): Promise<AccountRow> {
  const rows = await db
    .select()
    .from(schema.accounts)
    .where(eq(schema.accounts.id, id))
    .limit(1);
  const acc = rows[0];
  if (!acc || acc.type !== 'customer') throw new HttpError(404, 'customer not found');
  return acc;
}

/** First/primary user of an account (oldest user), or null. */
async function firstUser(accountId: UUID): Promise<UserRow | undefined> {
  const rows = await db
    .select()
    .from(schema.users)
    .where(eq(schema.users.accountId, accountId))
    .orderBy(asc(schema.users.createdAt))
    .limit(1);
  return rows[0];
}

/** List all customer accounts with their entitlements + primary user. */
export async function listCustomers(): Promise<CustomerWithEntitlements[]> {
  const accounts = await db
    .select()
    .from(schema.accounts)
    .where(eq(schema.accounts.type, 'customer'))
    .orderBy(asc(schema.accounts.name));

  const out: CustomerWithEntitlements[] = [];
  for (const acc of accounts) {
    const [user, entitlements] = await Promise.all([
      firstUser(acc.id),
      getEntitlementValues(acc.id),
    ]);
    out.push({
      account: toAccount(acc),
      entitlements,
      user: user ? toPublicUser(user) : null,
    });
  }
  return out;
}

/** Fetch one customer with entitlements + primary user. */
export async function getCustomer(id: UUID): Promise<CustomerWithEntitlements> {
  const acc = await loadCustomerAccount(id);
  const [user, entitlements] = await Promise.all([
    firstUser(acc.id),
    getEntitlementValues(acc.id),
  ]);
  return {
    account: toAccount(acc),
    entitlements,
    user: user ? toPublicUser(user) : null,
  };
}

export interface CreateCustomerArgs {
  name: string;
  userEmail: string;
  userName: string;
  password: string;
  plan?: string;
  locale?: string;
  entitlements?: Entitlements;
}

export interface CreatedCustomer {
  account: Account;
  user: PublicUser;
  entitlements: Entitlements;
}

/**
 * Create a customer account (parent = admin root) + an owner user with a bcrypt
 * password hash + a default entitlement_records row. `actorId` is the admin user
 * recorded as the entitlement record's updater.
 */
export async function createCustomer(
  args: CreateCustomerArgs,
  actorId: UUID,
): Promise<CreatedCustomer> {
  const name = args.name.trim();
  const userEmail = args.userEmail.trim();
  const userName = args.userName.trim();
  if (!name) throw new HttpError(400, 'name is required');
  if (!userEmail) throw new HttpError(400, 'userEmail is required');
  if (!userName) throw new HttpError(400, 'userName is required');
  if (!args.password || args.password.length < 6) {
    throw new HttpError(400, 'password must be at least 6 characters');
  }

  // Reject duplicate email up front for a clean 409 (also enforced by UNIQUE).
  const existing = await db
    .select({ id: schema.users.id })
    .from(schema.users)
    .where(eq(schema.users.email, userEmail))
    .limit(1);
  if (existing[0]) throw new HttpError(409, 'a user with that email already exists');

  const parentId = await getAdminRootId();
  const passwordHash = await bcrypt.hash(args.password, 10);
  const locale = args.locale ?? 'en';

  const accountRows = await db
    .insert(schema.accounts)
    .values({
      type: 'customer',
      name,
      parentId,
      status: 'active',
      plan: args.plan ?? null,
      locale,
    })
    .returning();
  const account = accountRows[0];

  let userRows;
  try {
    userRows = await db
      .insert(schema.users)
      .values({
        accountId: account.id,
        email: userEmail,
        name: userName,
        role: 'customer',
        passwordHash,
        locale: args.locale ?? null,
      })
      .returning();
  } catch (err) {
    // Roll back the orphan account if the user insert raced/failed (UNIQUE email).
    await db.delete(schema.accounts).where(eq(schema.accounts.id, account.id));
    if (err instanceof Error && /unique|duplicate/i.test(err.message)) {
      throw new HttpError(409, 'a user with that email already exists');
    }
    throw err;
  }
  const user = userRows[0];

  const entitlements = await seedEntitlements(account.id, actorId, args.entitlements);

  // Best-effort welcome email — a mail failure must NOT fail account creation.
  try {
    const mail = await sendWelcomeEmail({
      to: userEmail,
      name: userName,
      tempPassword: args.password,
    });
    if (mail.sent) {
      console.log(`[email] welcome email sent to ${userEmail} (${mail.messageId ?? 'ok'})`);
    } else {
      console.warn(`[email] welcome email to ${userEmail} not sent: ${mail.reason}`);
    }
  } catch (err) {
    console.warn(`[email] welcome email error for ${userEmail}:`, (err as Error).message);
  }

  return {
    account: toAccount(account),
    user: toPublicUser(user),
    entitlements: normalizeEntitlements(entitlements.values),
  };
}

export interface UpdateCustomerArgs {
  name?: string;
  status?: AccountStatus;
  plan?: string;
  locale?: string;
}

/** Rename / enable / disable / re-plan a customer. Returns before+after for audit. */
export async function updateCustomer(
  id: UUID,
  args: UpdateCustomerArgs,
): Promise<{ account: Account; before: Account }> {
  const before = await loadCustomerAccount(id);

  const set: Partial<typeof schema.accounts.$inferInsert> = { updatedAt: new Date() };
  if (typeof args.name === 'string') {
    const n = args.name.trim();
    if (!n) throw new HttpError(400, 'name cannot be empty');
    set.name = n;
  }
  if (args.status) {
    if (args.status !== 'active' && args.status !== 'disabled') {
      throw new HttpError(400, 'status must be active or disabled');
    }
    set.status = args.status;
  }
  if (typeof args.plan === 'string') set.plan = args.plan;
  if (typeof args.locale === 'string') set.locale = args.locale;

  const rows = await db
    .update(schema.accounts)
    .set(set)
    .where(eq(schema.accounts.id, id))
    .returning();

  return { account: toAccount(rows[0]), before: toAccount(before) };
}

// --- fleet & gateways --------------------------------------------------------

/** List every gateway with its bound farm/account + nodes, plus a status summary. */
export async function listFleet(): Promise<{
  gateways: FleetGateway[];
  summary: { total: number; online: number; offline: number; claimed: number; unbound: number };
}> {
  const gateways = await db
    .select()
    .from(schema.gateways)
    .orderBy(asc(schema.gateways.serial));

  const items: FleetGateway[] = [];
  const summary = { total: gateways.length, online: 0, offline: 0, claimed: 0, unbound: 0 };

  for (const g of gateways) {
    if (g.status === 'online') summary.online += 1;
    else if (g.status === 'offline') summary.offline += 1;
    else if (g.status === 'claimed') summary.claimed += 1;
    else summary.unbound += 1; // unbound (in stock) / revoked

    const farm = g.farmId
      ? (await db.select().from(schema.farms).where(eq(schema.farms.id, g.farmId)).limit(1))[0]
      : undefined;
    const account = g.accountId
      ? (
          await db
            .select()
            .from(schema.accounts)
            .where(eq(schema.accounts.id, g.accountId))
            .limit(1)
        )[0]
      : undefined;
    const nodeRows = await db
      .select()
      .from(schema.nodes)
      .where(eq(schema.nodes.gatewayId, g.id))
      .orderBy(asc(schema.nodes.createdAt));

    items.push({
      gateway: toGateway(g),
      farm: farm ? toFarm(farm) : null,
      account: account ? toAccount(account) : null,
      nodes: nodeRows.map(toNode),
    });
  }

  return { gateways: items, summary };
}

/** Every farm across all customers, each with its owning account (admin pickers). */
export async function listAllFarms(): Promise<AdminFarm[]> {
  const farms = await db.select().from(schema.farms).orderBy(asc(schema.farms.name));
  const out: AdminFarm[] = [];
  for (const f of farms) {
    const acc = (
      await db.select().from(schema.accounts).where(eq(schema.accounts.id, f.accountId)).limit(1)
    )[0];
    out.push({ farm: toFarm(f), account: acc ? toAccount(acc) : null });
  }
  return out;
}

export interface RegisterGatewayResult {
  gateway: Gateway;
  /** Plaintext device token — shown once, only the hash is stored. */
  deviceToken: string;
}

/**
 * Register a new gateway serial → create an unbound gateway + a device_tokens row
 * holding the bcrypt hash of a freshly-generated secret. The plaintext secret is
 * returned exactly once.
 */
export async function registerGateway(
  serial: string,
  compute: ComputeKind = 'esp32',
  model?: string,
): Promise<RegisterGatewayResult> {
  const s = serial.trim();
  if (!s) throw new HttpError(400, 'serial is required');
  if (compute !== 'esp32' && compute !== 'rpi4') {
    throw new HttpError(400, 'compute must be esp32 or rpi4');
  }

  const dup = await db
    .select({ id: schema.gateways.id })
    .from(schema.gateways)
    .where(eq(schema.gateways.serial, s))
    .limit(1);
  if (dup[0]) throw new HttpError(409, 'a gateway with that serial already exists');

  const gatewayRows = await db
    .insert(schema.gateways)
    .values({ serial: s, compute, model: model?.trim() || null, status: 'unbound' })
    .returning();
  const gateway = gatewayRows[0];

  const secret = nanoid(40);
  const secretHash = await bcrypt.hash(secret, 10);
  await db.insert(schema.deviceTokens).values({ gatewayId: gateway.id, secretHash });

  return { gateway: toGateway(gateway), deviceToken: secret };
}

/**
 * Claim an in-stock device to a customer account at purchase time (account-level;
 * no farm yet — the farm is auto-provisioned on first boot). Sets account_id,
 * status='claimed', claimed_at. Returns before+after for audit.
 */
export async function claimDevice(
  serial: string,
  accountId: UUID,
): Promise<{ gateway: Gateway; before: Gateway }> {
  const s = serial.trim();
  const gwRows = await db
    .select()
    .from(schema.gateways)
    .where(eq(schema.gateways.serial, s))
    .limit(1);
  const before = gwRows[0];
  if (!before) throw new HttpError(404, 'device not found');
  if (before.status === 'revoked') throw new HttpError(409, 'device is revoked');

  // Target must be an existing customer account.
  await loadCustomerAccount(accountId);

  const rows = await db
    .update(schema.gateways)
    .set({ accountId, status: 'claimed', claimedAt: new Date() })
    .where(eq(schema.gateways.id, before.id))
    .returning();

  return { gateway: toGateway(rows[0]), before: toGateway(before) };
}

/**
 * Bind a gateway to a farm: set farm_id + account_id (defaults to the farm's
 * owning account) and move it from `unbound` to `offline` (it comes online once
 * it connects/LWT reports). Returns before+after for audit.
 */
export async function bindGateway(
  id: UUID,
  farmId: UUID,
  accountId?: UUID,
): Promise<{ gateway: Gateway; before: Gateway }> {
  const gwRows = await db
    .select()
    .from(schema.gateways)
    .where(eq(schema.gateways.id, id))
    .limit(1);
  const before = gwRows[0];
  if (!before) throw new HttpError(404, 'gateway not found');

  const farmRows = await db
    .select()
    .from(schema.farms)
    .where(eq(schema.farms.id, farmId))
    .limit(1);
  const farm = farmRows[0];
  if (!farm) throw new HttpError(404, 'farm not found');

  const resolvedAccount = accountId ?? farm.accountId;
  if (accountId && accountId !== farm.accountId) {
    throw new HttpError(400, 'accountId does not own the target farm');
  }

  // Preserve an already-online status; otherwise mark bound-but-offline.
  const nextStatus = before.status === 'online' ? 'online' : 'offline';

  const rows = await db
    .update(schema.gateways)
    .set({ farmId, accountId: resolvedAccount, status: nextStatus })
    .where(eq(schema.gateways.id, id))
    .returning();

  return { gateway: toGateway(rows[0]), before: toGateway(before) };
}

/**
 * Record an OTA firmware target for a gateway. We set the gateway's fw_version to
 * the requested target (a real fleet would queue a job + flip on LWT confirm;
 * for this build the target is recorded directly and audited).
 */
export async function recordOta(
  id: UUID,
  fwVersion: string,
): Promise<{ gateway: Gateway; before: Gateway }> {
  const fw = fwVersion.trim();
  if (!fw) throw new HttpError(400, 'fwVersion is required');

  const gwRows = await db
    .select()
    .from(schema.gateways)
    .where(eq(schema.gateways.id, id))
    .limit(1);
  const before = gwRows[0];
  if (!before) throw new HttpError(404, 'gateway not found');

  const rows = await db
    .update(schema.gateways)
    .set({ fwVersion: fw })
    .where(eq(schema.gateways.id, id))
    .returning();

  return { gateway: toGateway(rows[0]), before: toGateway(before) };
}
