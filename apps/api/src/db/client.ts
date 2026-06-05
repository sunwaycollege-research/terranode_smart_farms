// Drizzle client over a node-postgres connection pool.
//
// The whole API shares one `pg.Pool` (driven by DATABASE_URL) and one drizzle
// instance bound to the full schema, so service code can do typed queries:
//
//   import { db, schema } from '../db/client';
//   const rows = await db.select().from(schema.zones);
//
// The raw `pool` is also exported for places that need hand-written SQL.

import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { schema } from './schema';

const connectionString =
  process.env.DATABASE_URL ??
  'postgres://teranode:teranode@localhost:5432/teranode';

/** Shared node-postgres connection pool (one per process). */
export const pool = new Pool({ connectionString });

/** Drizzle ORM instance bound to the full TERANODE schema. */
export const db = drizzle(pool, { schema });

export { schema };

export type Db = typeof db;
