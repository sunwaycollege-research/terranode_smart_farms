// Rules / schedules / dosing routes (unit 3.3) — mounted at `/rules` by
// index.ts (`app.use('/rules', rulesRouter)`, which is FROZEN).
//
// index.ts mounts this router ONLY at the `/rules` prefix, so the spec's
// resource paths (`/zones/:id/rules`, `/farms/:id/schedules`, `/schedules/:id`,
// `/farms/:id/dosing-profile`) are served here under that prefix. The effective,
// reachable surface is therefore:
//
//   GET  /rules/zones/:zoneId            → the zone's controller rule
//   PUT  /rules/zones/:zoneId            → hand-edit rule (source := manual)
//   GET  /rules/farms/:farmId/schedules  → list a farm's irrigation schedules
//   PUT  /rules/schedules/:scheduleId    → update one schedule
//   GET  /rules/farms/:farmId/dosing-profile  → the farm's fertigation profile
//   PUT  /rules/farms/:farmId/dosing-profile  → upsert the fertigation profile
//
// Customer-scoped (a customer touches only its own account; admin any). All DB
// logic lives in ../services/control.

import { Router, type Request, type Response, type NextFunction } from 'express';
import type {
  DosingPump,
  GetDosingProfileResponse,
  GetRuleResponse,
  ListSchedulesResponse,
  UpdateDosingProfileResponse,
  UpdateRuleResponse,
  UpdateScheduleResponse,
} from '@teranode/types';
import { requireAuth, scopeToCustomer } from '../middleware/auth';
import { HttpError } from '../middleware/error';
import {
  getDosingProfile,
  getRule,
  listSchedules,
  updateDosingProfile,
  updateRule,
  updateSchedule,
  type DosingProfilePatch,
  type RulePatch,
  type SchedulePatch,
} from '../services/control';

export const rulesRouter = Router();

rulesRouter.use(requireAuth, scopeToCustomer);

/** Small async-handler wrapper so thrown errors reach the error middleware. */
function wrap(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<void>,
): (req: Request, res: Response, next: NextFunction) => void {
  return (req, res, next) => {
    fn(req, res, next).catch(next);
  };
}

// --- tiny validators ----------------------------------------------------------

function optNumber(v: unknown, field: string): number | undefined {
  if (v === undefined) return undefined;
  if (typeof v !== 'number' || !Number.isFinite(v)) {
    throw new HttpError(400, `${field} must be a finite number`);
  }
  return v;
}

function optNullableNumber(v: unknown, field: string): number | null | undefined {
  if (v === undefined) return undefined;
  if (v === null) return null;
  if (typeof v !== 'number' || !Number.isFinite(v)) {
    throw new HttpError(400, `${field} must be a finite number or null`);
  }
  return v;
}

function optBoolean(v: unknown, field: string): boolean | undefined {
  if (v === undefined) return undefined;
  if (typeof v !== 'boolean') throw new HttpError(400, `${field} must be a boolean`);
  return v;
}

function optIntHour(v: unknown, field: string): number | undefined {
  if (v === undefined) return undefined;
  if (typeof v !== 'number' || !Number.isInteger(v)) {
    throw new HttpError(400, `${field} must be an integer`);
  }
  return v;
}

// --- zone rules ---------------------------------------------------------------

rulesRouter.get(
  '/zones/:zoneId',
  wrap(async (req, res) => {
    const rule: GetRuleResponse = await getRule(req.params.zoneId, req.scope!);
    res.json(rule);
  }),
);

rulesRouter.put(
  '/zones/:zoneId',
  wrap(async (req, res) => {
    const b = (req.body ?? {}) as Record<string, unknown>;
    const patch: RulePatch = {
      moistureLow: optNumber(b.moistureLow, 'moistureLow'),
      moistureHigh: optNumber(b.moistureHigh, 'moistureHigh'),
      rainSkipMm: optNumber(b.rainSkipMm, 'rainSkipMm'),
      phTarget: optNullableNumber(b.phTarget, 'phTarget'),
      ecTarget: optNullableNumber(b.ecTarget, 'ecTarget'),
    };
    const rule: UpdateRuleResponse = await updateRule(req.params.zoneId, patch, req.scope!);
    res.json(rule);
  }),
);

// --- farm schedules -----------------------------------------------------------

rulesRouter.get(
  '/farms/:farmId/schedules',
  wrap(async (req, res) => {
    const schedules = await listSchedules(req.params.farmId, req.scope!);
    const body: ListSchedulesResponse = { schedules };
    res.json(body);
  }),
);

rulesRouter.put(
  '/schedules/:scheduleId',
  wrap(async (req, res) => {
    const b = (req.body ?? {}) as Record<string, unknown>;
    const patch: SchedulePatch = {
      windowStartHour: optIntHour(b.windowStartHour, 'windowStartHour'),
      windowEndHour: optIntHour(b.windowEndHour, 'windowEndHour'),
      et0Aware: optBoolean(b.et0Aware, 'et0Aware'),
      maxRunMin: optNumber(b.maxRunMin, 'maxRunMin'),
      enabled: optBoolean(b.enabled, 'enabled'),
    };
    const schedule: UpdateScheduleResponse = await updateSchedule(
      req.params.scheduleId,
      patch,
      req.scope!,
    );
    res.json(schedule);
  }),
);

// --- farm dosing profile ------------------------------------------------------

rulesRouter.get(
  '/farms/:farmId/dosing-profile',
  wrap(async (req, res) => {
    const profile: GetDosingProfileResponse = await getDosingProfile(
      req.params.farmId,
      req.scope!,
    );
    res.json(profile);
  }),
);

rulesRouter.put(
  '/farms/:farmId/dosing-profile',
  wrap(async (req, res) => {
    const b = (req.body ?? {}) as Record<string, unknown>;
    let pumps: DosingPump[] | undefined;
    if (b.pumps !== undefined) {
      if (!Array.isArray(b.pumps)) throw new HttpError(400, 'pumps must be an array');
      pumps = b.pumps as DosingPump[];
    }
    const patch: DosingProfilePatch = {
      ecTarget: optNumber(b.ecTarget, 'ecTarget'),
      phTarget: optNumber(b.phTarget, 'phTarget'),
      pumps,
    };
    const profile: UpdateDosingProfileResponse = await updateDosingProfile(
      req.params.farmId,
      patch,
      req.scope!,
    );
    res.json(profile);
  }),
);
