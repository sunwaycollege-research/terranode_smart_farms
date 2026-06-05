// Control-plane service for unit 3.3 — actuators, zone rules, farm schedules,
// and farm dosing profiles. All DB access for the actuators/rules routers lives
// here so the route files stay thin (parse → authorize → call service → shape).
//
// Tenant scoping: every helper takes the effective `RequestScope` (from
// scopeToCustomer). A customer is hard-scoped to its own account_id; an admin
// (scope.isAdmin) may operate cross-tenant. Ownership is resolved by walking
// zone → farm → account and farm → account, so a customer can never read or
// mutate another tenant's rows.
//
// Pre-MQTT note (spec §5): the actuator command sets both `desired` AND the
// reported `state` directly in the DB, because the MQTT publisher + state
// reconciliation worker only land in Phase 4. We do NOT import a not-yet-
// existing mqtt module; we just update the row and report it back.

import { asc, eq } from 'drizzle-orm';
import type {
  Actuator,
  ActuatorAction,
  DosingProfile,
  DosingPump,
  Rule,
  Schedule,
} from '@teranode/types';
import { db, schema } from '../db/client';
import { HttpError } from '../middleware/error';
import type { RequestScope } from '../middleware/auth';

// --- row → wire serializers ---------------------------------------------------
//
// drizzle's `numeric` columns come back as JS strings; coerce to number for the
// wire entities (which type these as `number`). `null`s are preserved.

type ActuatorRow = typeof schema.actuators.$inferSelect;
type RuleRow = typeof schema.rules.$inferSelect;
type ScheduleRow = typeof schema.schedules.$inferSelect;
type DosingProfileRow = typeof schema.dosingProfiles.$inferSelect;

function numOrNull(v: string | null): number | null {
  return v === null || v === undefined ? null : Number(v);
}

function toActuator(a: ActuatorRow): Actuator {
  return {
    id: a.id,
    scope: a.scope,
    zoneId: a.zoneId ?? null,
    farmId: a.farmId ?? null,
    type: a.type,
    state: a.state,
    desired: a.desired ?? null,
    mode: a.mode === 'manual' ? 'manual' : 'auto',
  };
}

function toRule(r: RuleRow): Rule {
  return {
    zoneId: r.zoneId,
    moistureLow: Number(r.moistureLow),
    moistureHigh: Number(r.moistureHigh),
    rainSkipMm: Number(r.rainSkipMm),
    phTarget: numOrNull(r.phTarget),
    ecTarget: numOrNull(r.ecTarget),
    source: r.source === 'manual' ? 'manual' : 'crop',
    appliedStage: r.appliedStage ?? null,
    updatedAt: r.updatedAt.toISOString(),
  };
}

function toSchedule(s: ScheduleRow): Schedule {
  return {
    id: s.id,
    farmId: s.farmId,
    windowStartHour: s.windowStartHour,
    windowEndHour: s.windowEndHour,
    et0Aware: s.et0Aware,
    maxRunMin: s.maxRunMin,
    enabled: s.enabled,
  };
}

function toDosingProfile(p: DosingProfileRow): DosingProfile {
  return {
    farmId: p.farmId,
    ecTarget: Number(p.ecTarget),
    phTarget: Number(p.phTarget),
    pumps: (p.pumps ?? []) as DosingPump[],
  };
}

// --- ownership / scoping helpers ---------------------------------------------

/** Resolve a farm and assert the caller's scope may touch it. 404 if missing,
 *  403 if it belongs to another tenant (and the caller is not an admin). */
async function farmInScope(
  farmId: string,
  scope: RequestScope,
): Promise<{ accountId: string }> {
  const rows = await db
    .select({ accountId: schema.farms.accountId })
    .from(schema.farms)
    .where(eq(schema.farms.id, farmId))
    .limit(1);
  const farm = rows[0];
  if (!farm) throw new HttpError(404, 'farm not found');
  if (!scope.isAdmin && farm.accountId !== scope.accountId) {
    throw new HttpError(403, 'cannot access another account');
  }
  return { accountId: farm.accountId };
}

/** Resolve a zone (via its farm) and assert the caller's scope may touch it. */
async function zoneInScope(
  zoneId: string,
  scope: RequestScope,
): Promise<{ farmId: string; accountId: string }> {
  const rows = await db
    .select({
      farmId: schema.zones.farmId,
      accountId: schema.farms.accountId,
    })
    .from(schema.zones)
    .innerJoin(schema.farms, eq(schema.zones.farmId, schema.farms.id))
    .where(eq(schema.zones.id, zoneId))
    .limit(1);
  const zone = rows[0];
  if (!zone) throw new HttpError(404, 'zone not found');
  if (!scope.isAdmin && zone.accountId !== scope.accountId) {
    throw new HttpError(403, 'cannot access another account');
  }
  return { farmId: zone.farmId, accountId: zone.accountId };
}

/** Resolve an actuator (via its zone or farm) and assert scope. */
async function actuatorInScope(
  actuatorId: string,
  scope: RequestScope,
): Promise<ActuatorRow> {
  const rows = await db
    .select()
    .from(schema.actuators)
    .where(eq(schema.actuators.id, actuatorId))
    .limit(1);
  const act = rows[0];
  if (!act) throw new HttpError(404, 'actuator not found');

  // An actuator is owned by a zone (scope=zone) or a farm (scope=farm); walk to
  // the owning farm to resolve the tenant and authorize.
  if (act.zoneId) {
    await zoneInScope(act.zoneId, scope);
  } else if (act.farmId) {
    await farmInScope(act.farmId, scope);
  } else {
    // Orphan actuator with no zone/farm — only an admin may touch it.
    if (!scope.isAdmin) throw new HttpError(403, 'cannot access another account');
  }
  return act;
}

// --- actuators ----------------------------------------------------------------

/** Map a command action → the boolean desired state it implies.
 *  open/on/dose → true (energize), close/off → false. */
function actionToDesired(action: ActuatorAction): boolean {
  switch (action) {
    case 'open':
    case 'on':
    case 'dose':
      return true;
    case 'close':
    case 'off':
      return false;
    default:
      // exhaustive — unknown actions are rejected before we get here.
      return false;
  }
}

/** Assert the action is valid for the actuator type (valves open/close, pumps
 *  on/off, dosing pumps dose/off). Kept lenient: we accept the canonical
 *  energize/de-energize verbs for any type so the UI can stay simple, but reject
 *  obviously wrong verbs (e.g. `dose` on a valve). */
function assertActionForType(type: ActuatorRow['type'], action: ActuatorAction): void {
  const allowed: Record<ActuatorRow['type'], ActuatorAction[]> = {
    valve: ['open', 'close', 'on', 'off'],
    pump: ['on', 'off', 'open', 'close'],
    dosing: ['dose', 'on', 'off'],
  };
  if (!allowed[type].includes(action)) {
    throw new HttpError(400, `action '${action}' is not valid for a ${type} actuator`);
  }
}

export interface CommandResult {
  actuator: Actuator;
  pending: boolean;
}

/**
 * POST /actuators/:id/command — set desired state from the action and (pre-MQTT)
 * also set the reported `state` to match, plus flip the actuator into manual
 * mode (an explicit command is a manual override). Returns the updated actuator
 * plus `pending` (true while desired !== reported — always false here until the
 * MQTT reconciliation worker lands in Phase 4 and may set desired ahead of
 * state).
 */
export async function commandActuator(
  actuatorId: string,
  action: ActuatorAction,
  scope: RequestScope,
): Promise<CommandResult> {
  const existing = await actuatorInScope(actuatorId, scope);
  assertActionForType(existing.type, action);

  const desired = actionToDesired(action);

  // Pre-MQTT: there is no device to confirm the desired state, so we optimistically
  // set the reported state to equal desired. When the Phase-4 publisher + ingest
  // state worker exist, the publisher will set `desired` and the ingest worker will
  // later set `state` from the device's `.../state` report.
  const updated = await db
    .update(schema.actuators)
    .set({ desired, state: desired, mode: 'manual' })
    .where(eq(schema.actuators.id, actuatorId))
    .returning();

  const row = updated[0] ?? existing;
  const actuator = toActuator(row);
  return { actuator, pending: actuator.desired !== null && actuator.desired !== actuator.state };
}

// --- zone rules ---------------------------------------------------------------

/** GET /zones/:id/rules — the controller rule for a zone. 404 if none exists. */
export async function getRule(zoneId: string, scope: RequestScope): Promise<Rule> {
  await zoneInScope(zoneId, scope);
  const rows = await db
    .select()
    .from(schema.rules)
    .where(eq(schema.rules.zoneId, zoneId))
    .limit(1);
  const rule = rows[0];
  if (!rule) throw new HttpError(404, 'no rule for zone');
  return toRule(rule);
}

export interface RulePatch {
  moistureLow?: number;
  moistureHigh?: number;
  rainSkipMm?: number;
  phTarget?: number | null;
  ecTarget?: number | null;
}

/**
 * PUT /zones/:id/rules — hand-edit the controller rule. Any edit marks the rule
 * `source = 'manual'` (it no longer tracks the crop band) and bumps updatedAt.
 * Upserts: if the zone has no rule row yet, one is created from the patch
 * (missing moisture bounds default to a safe 40/70 band).
 */
export async function updateRule(
  zoneId: string,
  patch: RulePatch,
  scope: RequestScope,
): Promise<Rule> {
  await zoneInScope(zoneId, scope);

  const existingRows = await db
    .select()
    .from(schema.rules)
    .where(eq(schema.rules.zoneId, zoneId))
    .limit(1);
  const existing = existingRows[0];

  // Resolve the new field values (patch wins; else existing; else default).
  const moistureLow =
    patch.moistureLow ?? (existing ? Number(existing.moistureLow) : 40);
  const moistureHigh =
    patch.moistureHigh ?? (existing ? Number(existing.moistureHigh) : 70);

  if (moistureLow >= moistureHigh) {
    throw new HttpError(400, 'moistureLow must be less than moistureHigh');
  }

  const rainSkipMm =
    patch.rainSkipMm ?? (existing ? Number(existing.rainSkipMm) : 4);
  const phTarget =
    patch.phTarget !== undefined
      ? patch.phTarget
      : existing
        ? numOrNull(existing.phTarget)
        : null;
  const ecTarget =
    patch.ecTarget !== undefined
      ? patch.ecTarget
      : existing
        ? numOrNull(existing.ecTarget)
        : null;

  const values = {
    zoneId,
    moistureLow: String(moistureLow),
    moistureHigh: String(moistureHigh),
    rainSkipMm: String(rainSkipMm),
    phTarget: phTarget === null ? null : String(phTarget),
    ecTarget: ecTarget === null ? null : String(ecTarget),
    source: 'manual',
    appliedStage: existing?.appliedStage ?? null,
    updatedAt: new Date(),
  };

  const upserted = await db
    .insert(schema.rules)
    .values(values)
    .onConflictDoUpdate({
      target: schema.rules.zoneId,
      set: {
        moistureLow: values.moistureLow,
        moistureHigh: values.moistureHigh,
        rainSkipMm: values.rainSkipMm,
        phTarget: values.phTarget,
        ecTarget: values.ecTarget,
        source: 'manual',
        updatedAt: values.updatedAt,
      },
    })
    .returning();

  return toRule(upserted[0]);
}

// --- farm schedules -----------------------------------------------------------

/** GET /farms/:id/schedules — all irrigation schedules for a farm. */
export async function listSchedules(
  farmId: string,
  scope: RequestScope,
): Promise<Schedule[]> {
  await farmInScope(farmId, scope);
  const rows = await db
    .select()
    .from(schema.schedules)
    .where(eq(schema.schedules.farmId, farmId))
    .orderBy(asc(schema.schedules.windowStartHour));
  return rows.map(toSchedule);
}

export interface SchedulePatch {
  windowStartHour?: number;
  windowEndHour?: number;
  et0Aware?: boolean;
  maxRunMin?: number;
  enabled?: boolean;
}

/** PUT /schedules/:id — update a single schedule (scoped via its farm). */
export async function updateSchedule(
  scheduleId: string,
  patch: SchedulePatch,
  scope: RequestScope,
): Promise<Schedule> {
  const existingRows = await db
    .select()
    .from(schema.schedules)
    .where(eq(schema.schedules.id, scheduleId))
    .limit(1);
  const existing = existingRows[0];
  if (!existing) throw new HttpError(404, 'schedule not found');
  await farmInScope(existing.farmId, scope);

  const windowStartHour = patch.windowStartHour ?? existing.windowStartHour;
  const windowEndHour = patch.windowEndHour ?? existing.windowEndHour;
  if (windowStartHour < 0 || windowStartHour > 23 || windowEndHour < 0 || windowEndHour > 23) {
    throw new HttpError(400, 'window hours must be within 0..23');
  }
  if (windowStartHour >= windowEndHour) {
    throw new HttpError(400, 'windowStartHour must be before windowEndHour');
  }
  const maxRunMin = patch.maxRunMin ?? existing.maxRunMin;
  if (maxRunMin <= 0) throw new HttpError(400, 'maxRunMin must be positive');

  const updated = await db
    .update(schema.schedules)
    .set({
      windowStartHour,
      windowEndHour,
      et0Aware: patch.et0Aware ?? existing.et0Aware,
      maxRunMin,
      enabled: patch.enabled ?? existing.enabled,
    })
    .where(eq(schema.schedules.id, scheduleId))
    .returning();

  return toSchedule(updated[0]);
}

// --- farm dosing profile ------------------------------------------------------

/** GET /farms/:id/dosing-profile — the farm's fertigation profile. 404 if none. */
export async function getDosingProfile(
  farmId: string,
  scope: RequestScope,
): Promise<DosingProfile> {
  await farmInScope(farmId, scope);
  const rows = await db
    .select()
    .from(schema.dosingProfiles)
    .where(eq(schema.dosingProfiles.farmId, farmId))
    .limit(1);
  const profile = rows[0];
  if (!profile) throw new HttpError(404, 'no dosing profile for farm');
  return toDosingProfile(profile);
}

export interface DosingProfilePatch {
  ecTarget?: number;
  phTarget?: number;
  pumps?: DosingPump[];
}

/**
 * PUT /farms/:id/dosing-profile — upsert the farm's fertigation targets + pumps.
 * Creates the profile if absent (ecTarget/phTarget required on first create).
 */
export async function updateDosingProfile(
  farmId: string,
  patch: DosingProfilePatch,
  scope: RequestScope,
): Promise<DosingProfile> {
  await farmInScope(farmId, scope);

  const existingRows = await db
    .select()
    .from(schema.dosingProfiles)
    .where(eq(schema.dosingProfiles.farmId, farmId))
    .limit(1);
  const existing = existingRows[0];

  const ecTarget =
    patch.ecTarget ?? (existing ? Number(existing.ecTarget) : undefined);
  const phTarget =
    patch.phTarget ?? (existing ? Number(existing.phTarget) : undefined);
  if (ecTarget === undefined || phTarget === undefined) {
    throw new HttpError(400, 'ecTarget and phTarget are required to create a dosing profile');
  }
  if (phTarget < 0 || phTarget > 14) throw new HttpError(400, 'phTarget must be within 0..14');
  if (ecTarget < 0) throw new HttpError(400, 'ecTarget must be non-negative');

  const pumps: DosingPump[] = patch.pumps ?? (existing?.pumps as DosingPump[]) ?? [];

  const upserted = await db
    .insert(schema.dosingProfiles)
    .values({
      farmId,
      ecTarget: String(ecTarget),
      phTarget: String(phTarget),
      pumps,
    })
    .onConflictDoUpdate({
      target: schema.dosingProfiles.farmId,
      set: {
        ecTarget: String(ecTarget),
        phTarget: String(phTarget),
        pumps,
      },
    })
    .returning();

  return toDosingProfile(upserted[0]);
}
