// Postgres connection pool for the ingest worker.
//
// One shared `pg.Pool` for the whole process. The connection string comes from
// DATABASE_URL (loaded by `import 'dotenv/config'` at the entrypoint, with the
// ingest cwd reading apps/ingest/.env). We still fall back to the docker-compose
// localhost default if the var is missing so the worker can run standalone.

import { Pool } from 'pg';

const DATABASE_URL =
  process.env.DATABASE_URL ??
  'postgres://teranode:teranode@localhost:5433/teranode';

/** Shared command pool (lazy — connects on first query). */
export const pool = new Pool({
  connectionString: DATABASE_URL,
  // Ingest is write-heavy but low-concurrency; a small pool is plenty.
  max: 8,
  idleTimeoutMillis: 30_000,
});

pool.on('error', (err) => {
  // A pooled client dropped — don't crash the worker; the next query reconnects.
  console.error('[ingest][pg] pool error:', err.message);
});

/** Run a parameterized query and return its rows. */
export async function query<T extends Record<string, unknown> = Record<string, unknown>>(
  text: string,
  params?: ReadonlyArray<unknown>,
): Promise<T[]> {
  const res = await pool.query(text, params as unknown[]);
  return res.rows as T[];
}

/** Close the pool (graceful shutdown). */
export async function closePool(): Promise<void> {
  await pool.end();
}
