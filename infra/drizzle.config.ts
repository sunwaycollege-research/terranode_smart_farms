// drizzle-kit config for the TERANODE Postgres/TimescaleDB schema.
//
// NOTE: the authoritative DDL is the idempotent raw-SQL migration in
// `apps/api/src/db/migrate.ts` (it covers TimescaleDB hypertables, continuous
// aggregates, and retention/compression policies that drizzle-kit cannot model).
// This config is provided for development convenience only:
//   - `drizzle-kit generate` → emit a SQL diff into infra/migrations
//   - `drizzle-kit studio`   → browse the live DB
// Do NOT use `drizzle-kit push` as the primary path — prefer the raw migration.

import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dialect: 'postgresql',
  // path is relative to this config file (infra/ → ../apps/api/...)
  schema: '../apps/api/src/db/schema.ts',
  out: './migrations',
  dbCredentials: {
    url:
      process.env.DATABASE_URL ??
      'postgres://teranode:teranode@localhost:5432/teranode',
  },
  verbose: true,
  strict: true,
});
