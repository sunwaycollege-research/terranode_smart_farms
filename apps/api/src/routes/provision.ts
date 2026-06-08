// Device-facing provisioning route (NOT JWT-authed — the device authenticates
// with its baked-in { serial, secret }). This is the "phone home" a flashed
// ESP32 makes on first boot to discover which customer it belongs to.
//
//   POST /provision { serial, secret, fwVersion?, wifiSsid?, capabilities? }
//     200 { status:'linked', accountId, farmId, gatewayId, mqttUrl, ... }
//     202 { status:'pending', retryAfterSec }   (valid device, not yet sold)
//     401/403/404 on bad/unknown/revoked credentials
//
// index.ts mounts this at '/provision'.

import { Router, type NextFunction, type Request, type Response } from 'express';
import { z } from 'zod';
import type { ProvisionResponse } from '@teranode/types';
import { HttpError } from '../middleware/error';
import { provisionDevice } from '../services/provisioning';

export const provisionRouter = Router();

function wrap(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<void>,
): (req: Request, res: Response, next: NextFunction) => void {
  return (req, res, next) => {
    fn(req, res, next).catch(next);
  };
}

const channelType = z.enum([
  'moisture',
  'ph',
  'ec',
  'n',
  'p',
  'k',
  'soiltemp',
  'airtemp',
  'humidity',
  'pressure',
  'rain',
  'flow',
]);

const provisionSchema = z.object({
  serial: z.string().min(1),
  secret: z.string().min(1),
  fwVersion: z.string().optional(),
  wifiSsid: z.string().optional(),
  capabilities: z
    .object({
      channels: z.array(channelType),
      zones: z.number().int().positive().optional(),
      pump: z.boolean().optional(),
      dosing: z.boolean().optional(),
    })
    .optional(),
});

provisionRouter.post(
  '/',
  wrap(async (req, res) => {
    const parsed = provisionSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new HttpError(400, 'invalid provision payload', parsed.error.flatten());
    }
    const result: ProvisionResponse = await provisionDevice(parsed.data);
    res.status(result.status === 'pending' ? 202 : 200).json(result);
  }),
);
