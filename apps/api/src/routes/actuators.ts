// Actuator command routes (unit 3.3) — mounted at `/actuators` by index.ts.
//
//   POST /actuators/:id/command   { action: open|close|on|off|dose, volumeMl? }
//       → { actuator, pending }   (desired-vs-reported control)
//
// Pre-MQTT (the publisher lands in Phase 4) the command sets BOTH the desired
// state and the reported `state` directly in the DB and reports the result.
// Customer-scoped: a customer may only command actuators under its own account;
// an admin may command any. All DB logic lives in ../services/control.

import { Router, type Request, type Response, type NextFunction } from 'express';
import type { ActuatorAction, ActuatorCommandResponse } from '@teranode/types';
import { requireAuth, scopeToCustomer } from '../middleware/auth';
import { HttpError } from '../middleware/error';
import { commandActuator } from '../services/control';

export const actuatorsRouter = Router();

actuatorsRouter.use(requireAuth, scopeToCustomer);

const ACTUATOR_ACTIONS: readonly ActuatorAction[] = ['open', 'close', 'on', 'off', 'dose'];

/** Small async-handler wrapper so thrown errors reach the error middleware. */
function wrap(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<void>,
): (req: Request, res: Response, next: NextFunction) => void {
  return (req, res, next) => {
    fn(req, res, next).catch(next);
  };
}

// --- POST /actuators/:id/command ---------------------------------------------

actuatorsRouter.post(
  '/:id/command',
  wrap(async (req, res) => {
    const scope = req.scope!;
    const { id } = req.params;
    const { action } = (req.body ?? {}) as { action?: unknown };

    if (typeof action !== 'string' || !ACTUATOR_ACTIONS.includes(action as ActuatorAction)) {
      throw new HttpError(400, `action must be one of: ${ACTUATOR_ACTIONS.join(', ')}`);
    }

    const result = await commandActuator(id, action as ActuatorAction, scope);
    const body: ActuatorCommandResponse = {
      actuator: result.actuator,
      pending: result.pending,
    };
    res.json(body);
  }),
);
