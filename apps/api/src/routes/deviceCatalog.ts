// REAL — GET /device-catalog. Returns the seeded device-catalog rows so clients
// can render entitlement editors. Authed (any role).
//
// Reads from the DB so admins see live catalog rows; falls back to the static
// @teranode/types seed if the table is empty/unreachable (keeps the surface
// usable before/around seeding).

import { Router, type Request, type Response, type NextFunction } from 'express';
import { asc } from 'drizzle-orm';
import type {
  DeviceCatalogCategory,
  DeviceCatalogItem,
  DeviceCatalogKind,
  DeviceCatalogResponse,
  EntitlementValue,
} from '@teranode/types';
import { DEVICE_CATALOG } from '@teranode/types';
import { db, schema } from '../db/client';
import { requireAuth } from '../middleware/auth';

export const deviceCatalogRouter = Router();

type CatalogRow = typeof schema.deviceCatalog.$inferSelect;

function toItem(r: CatalogRow): DeviceCatalogItem {
  return {
    key: r.key,
    label: r.label,
    category: r.category as DeviceCatalogCategory,
    kind: r.kind as DeviceCatalogKind,
    defaultValue: r.defaultValue as EntitlementValue,
    hint: r.hint ?? null,
    gatesDashboard: r.gatesDashboard,
  };
}

deviceCatalogRouter.get(
  '/',
  requireAuth,
  (req: Request, res: Response, next: NextFunction) => {
    void req;
    db.select()
      .from(schema.deviceCatalog)
      .orderBy(asc(schema.deviceCatalog.category), asc(schema.deviceCatalog.key))
      .then((rows) => {
        const items: DeviceCatalogItem[] = rows.length ? rows.map(toItem) : [...DEVICE_CATALOG];
        const body: DeviceCatalogResponse = { items };
        res.json(body);
      })
      .catch(next);
  },
);
