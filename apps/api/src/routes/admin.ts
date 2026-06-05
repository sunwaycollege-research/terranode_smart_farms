// REAL — admin routes (unit 3.1): customers, entitlements, fleet/gateways, audit.
//
// All endpoints require the admin role (`requireAdmin`). Every mutation writes an
// `audit_log` row (actor + action + target + before/after) via the audit service.
//
//   GET    /admin/customers                       list customers + entitlements
//   POST   /admin/customers                       create account + owner + entitlements
//   GET    /admin/customers/:id                   one customer + entitlements
//   PATCH  /admin/customers/:id                   rename / enable / disable / plan
//   PATCH  /admin/customers/:id/entitlements      edit entitlements (ALWAYS allowed)
//   GET    /admin/fleet                           all gateways + status + bindings
//   POST   /admin/gateways                        register serial → device token
//   POST   /admin/gateways/:id/bind               attach to a farm + account
//   POST   /admin/gateways/:id/ota                record a firmware target
//   GET    /admin/audit                           recent audit log
//
// index.ts imports { adminRouter } from './routes/admin' — keep that export name.

import { Router, type NextFunction, type Request, type Response } from 'express';
import { z } from 'zod';
import type {
  AdminFarmsResponse,
  AuditResponse,
  BindGatewayResponse,
  ClaimDeviceResponse,
  CreateCustomerResponse,
  FleetResponse,
  GetCustomerResponse,
  ListCustomersResponse,
  OtaResponse,
  RegisterGatewayResponse,
  UpdateCustomerResponse,
  UpdateEntitlementsResponse,
} from '@teranode/types';
import { requireAdmin } from '../middleware/auth';
import { HttpError } from '../middleware/error';
import {
  bindGateway,
  claimDevice,
  createCustomer,
  getCustomer,
  listAllFarms,
  listCustomers,
  listFleet,
  recordOta,
  registerGateway,
  updateCustomer,
} from '../services/customers';
import { updateEntitlements } from '../services/entitlements';
import { listAudit, writeAudit } from '../services/audit';

export const adminRouter = Router();

// --- helpers -----------------------------------------------------------------

/** Async-handler wrapper so thrown errors reach the error middleware. */
function wrap(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<void>,
): (req: Request, res: Response, next: NextFunction) => void {
  return (req, res, next) => {
    fn(req, res, next).catch(next);
  };
}

/** Validate a body against a zod schema → 400 with details on failure. */
function parseBody<T>(schema: z.ZodType<T>, body: unknown): T {
  const result = schema.safeParse(body ?? {});
  if (!result.success) {
    throw new HttpError(400, 'invalid request body', result.error.flatten());
  }
  return result.data;
}

/** A UUID path param, validated. */
function uuidParam(req: Request, name: string): string {
  const v = req.params[name];
  if (!z.string().uuid().safeParse(v).success) {
    throw new HttpError(400, `invalid ${name}`);
  }
  return v;
}

// --- zod schemas (mirror the §5 DTOs) ----------------------------------------

const entitlementValue = z.union([z.number(), z.boolean()]);
const entitlements = z.record(entitlementValue);

const createCustomerSchema = z.object({
  name: z.string().min(1),
  userEmail: z.string().email(),
  userName: z.string().min(1),
  password: z.string().min(6),
  plan: z.string().optional(),
  locale: z.string().optional(),
  entitlements: entitlements.optional(),
});

const updateCustomerSchema = z
  .object({
    name: z.string().min(1).optional(),
    status: z.enum(['active', 'disabled']).optional(),
    plan: z.string().optional(),
    locale: z.string().optional(),
  })
  .refine((b) => Object.keys(b).length > 0, { message: 'no fields to update' });

const updateEntitlementsSchema = z.object({ values: entitlements });

const registerGatewaySchema = z.object({
  serial: z.string().min(1),
  compute: z.enum(['esp32', 'rpi4']).optional(),
  model: z.string().optional(),
});

const claimDeviceSchema = z.object({ accountId: z.string().uuid() });

const bindGatewaySchema = z.object({
  farmId: z.string().uuid(),
  accountId: z.string().uuid().optional(),
});

const otaSchema = z.object({ fwVersion: z.string().min(1) });

// All admin routes are admin-only.
adminRouter.use(requireAdmin);

// --- customers ---------------------------------------------------------------

adminRouter.get(
  '/customers',
  wrap(async (_req, res) => {
    const customers = await listCustomers();
    const body: ListCustomersResponse = { customers };
    res.json(body);
  }),
);

adminRouter.post(
  '/customers',
  wrap(async (req, res) => {
    const input = parseBody(createCustomerSchema, req.body);
    const created = await createCustomer(input, req.auth!.userId);
    await writeAudit({
      actorId: req.auth!.userId,
      accountId: created.account.id,
      action: 'customer.create',
      target: `customer:${created.account.id}`,
      before: null,
      after: {
        name: created.account.name,
        plan: created.account.plan,
        userEmail: created.user.email,
        entitlements: created.entitlements,
      },
    });
    const body: CreateCustomerResponse = {
      account: created.account,
      user: created.user,
      entitlements: created.entitlements,
    };
    res.status(201).json(body);
  }),
);

adminRouter.get(
  '/customers/:id',
  wrap(async (req, res) => {
    const id = uuidParam(req, 'id');
    const customer = await getCustomer(id);
    const body: GetCustomerResponse = customer;
    res.json(body);
  }),
);

adminRouter.patch(
  '/customers/:id',
  wrap(async (req, res) => {
    const id = uuidParam(req, 'id');
    const input = parseBody(updateCustomerSchema, req.body);
    const { account, before } = await updateCustomer(id, input);
    await writeAudit({
      actorId: req.auth!.userId,
      accountId: account.id,
      action: 'customer.update',
      target: `customer:${account.id}`,
      before: { name: before.name, status: before.status, plan: before.plan, locale: before.locale },
      after: { name: account.name, status: account.status, plan: account.plan, locale: account.locale },
    });
    const body: UpdateCustomerResponse = account;
    res.json(body);
  }),
);

// Entitlements editing is ALWAYS allowed (no create-time lock in the 2-role model).
adminRouter.patch(
  '/customers/:id/entitlements',
  wrap(async (req, res) => {
    const id = uuidParam(req, 'id');
    // Ensure the target is a real customer (404 otherwise).
    await getCustomer(id);
    const { values } = parseBody(updateEntitlementsSchema, req.body);
    const { record, previous } = await updateEntitlements(id, values, req.auth!.userId);
    await writeAudit({
      actorId: req.auth!.userId,
      accountId: id,
      action: 'customer.entitlements.update',
      target: `customer:${id}`,
      before: previous ? { values: previous } : null,
      after: { values: record.values },
    });
    const body: UpdateEntitlementsResponse = record;
    res.json(body);
  }),
);

// --- fleet & gateways --------------------------------------------------------

adminRouter.get(
  '/fleet',
  wrap(async (_req, res) => {
    const { gateways, summary } = await listFleet();
    const body: FleetResponse = { gateways, summary };
    res.json(body);
  }),
);

// Every farm across all customers — for admin farm pickers (bind / analytics).
adminRouter.get(
  '/farms',
  wrap(async (_req, res) => {
    const farms = await listAllFarms();
    const body: AdminFarmsResponse = { farms };
    res.json(body);
  }),
);

adminRouter.post(
  '/gateways',
  wrap(async (req, res) => {
    const input = parseBody(registerGatewaySchema, req.body);
    const { gateway, deviceToken } = await registerGateway(
      input.serial,
      input.compute,
      input.model,
    );
    await writeAudit({
      actorId: req.auth!.userId,
      accountId: null,
      action: 'gateway.register',
      target: `gateway:${gateway.id}`,
      before: null,
      after: { serial: gateway.serial, compute: gateway.compute, model: gateway.model, status: gateway.status },
    });
    const body: RegisterGatewayResponse = { gateway, deviceToken };
    res.status(201).json(body);
  }),
);

// Claim an in-stock device to a customer at purchase (account-level; farm auto-
// provisioned on first boot). Serial is the device id printed on the label.
adminRouter.post(
  '/devices/:serial/claim',
  wrap(async (req, res) => {
    const serial = String(req.params.serial ?? '').trim();
    if (!serial) throw new HttpError(400, 'serial is required');
    const { accountId } = parseBody(claimDeviceSchema, req.body);
    const { gateway, before } = await claimDevice(serial, accountId);
    await writeAudit({
      actorId: req.auth!.userId,
      accountId,
      action: 'device.claim',
      target: `gateway:${gateway.id}`,
      before: { accountId: before.accountId, status: before.status },
      after: { accountId: gateway.accountId, status: gateway.status },
    });
    const body: ClaimDeviceResponse = gateway;
    res.json(body);
  }),
);

adminRouter.post(
  '/gateways/:id/bind',
  wrap(async (req, res) => {
    const id = uuidParam(req, 'id');
    const input = parseBody(bindGatewaySchema, req.body);
    const { gateway, before } = await bindGateway(id, input.farmId, input.accountId);
    await writeAudit({
      actorId: req.auth!.userId,
      accountId: gateway.accountId,
      action: 'gateway.bind',
      target: `gateway:${gateway.id}`,
      before: { farmId: before.farmId, accountId: before.accountId, status: before.status },
      after: { farmId: gateway.farmId, accountId: gateway.accountId, status: gateway.status },
    });
    const body: BindGatewayResponse = gateway;
    res.json(body);
  }),
);

adminRouter.post(
  '/gateways/:id/ota',
  wrap(async (req, res) => {
    const id = uuidParam(req, 'id');
    const input = parseBody(otaSchema, req.body);
    const { gateway, before } = await recordOta(id, input.fwVersion);
    await writeAudit({
      actorId: req.auth!.userId,
      accountId: gateway.accountId,
      action: 'gateway.ota',
      target: `gateway:${gateway.id}`,
      before: { fwVersion: before.fwVersion },
      after: { fwVersion: gateway.fwVersion },
    });
    const body: OtaResponse = { gateway, accepted: true };
    res.json(body);
  }),
);

// --- audit -------------------------------------------------------------------

adminRouter.get(
  '/audit',
  wrap(async (req, res) => {
    const q = req.query;
    const entries = await listAudit({
      accountId: typeof q.accountId === 'string' ? q.accountId : undefined,
      actorId: typeof q.actorId === 'string' ? q.actorId : undefined,
      from: typeof q.from === 'string' ? q.from : undefined,
      to: typeof q.to === 'string' ? q.to : undefined,
      limit: typeof q.limit === 'string' ? Number(q.limit) : undefined,
    });
    const body: AuditResponse = { entries };
    res.json(body);
  }),
);
