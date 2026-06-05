// Alerts routes (spec §5) — customer-scoped list + acknowledge.
//
//   GET  /alerts            → { alerts: Alert[] }   newest first, en+ne messages
//   POST /alerts/:id/ack    → Alert                 sets acknowledged_at = now
//
// Both run requireAuth + scopeToCustomer: a customer is hard-scoped to its own
// account; an admin may target a customer via ?accountId (handled by the
// middleware, which sets `req.scope.accountId`).

import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import type { AckAlertResponse, AlertsResponse } from '@teranode/types';
import { requireAuth, scopeToCustomer } from '../middleware/auth';
import { HttpError } from '../middleware/error';
import { acknowledgeAlert, listAlerts, type ListAlertsFilters } from '../services/alerts';

export const alertsRouter = Router();

alertsRouter.use(requireAuth, scopeToCustomer);

/** Small async-handler wrapper so thrown errors reach the error middleware. */
function wrap(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<void>,
): (req: Request, res: Response, next: NextFunction) => void {
  return (req, res, next) => {
    fn(req, res, next).catch(next);
  };
}

const uuid = z.string().uuid();

const alertsQuerySchema = z.object({
  farmId: uuid.optional(),
  zoneId: uuid.optional(),
  severity: z.enum(['info', 'warn', 'critical']).optional(),
  acknowledged: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
  limit: z.coerce.number().int().positive().max(500).optional(),
});

// --- GET /alerts -------------------------------------------------------------

alertsRouter.get(
  '/',
  wrap(async (req, res) => {
    const parsed = alertsQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      throw new HttpError(400, 'invalid query parameters', parsed.error.flatten());
    }
    const filters: ListAlertsFilters = parsed.data;
    const alerts = await listAlerts(req.scope!.accountId, filters);
    const body: AlertsResponse = { alerts };
    res.json(body);
  }),
);

// --- POST /alerts/:id/ack ----------------------------------------------------

alertsRouter.post(
  '/:id/ack',
  wrap(async (req, res) => {
    const id = uuid.safeParse(req.params.id);
    if (!id.success) throw new HttpError(400, 'invalid alert id');
    const alert = await acknowledgeAlert(req.scope!.accountId, id.data);
    const body: AckAlertResponse = alert;
    res.json(body);
  }),
);
