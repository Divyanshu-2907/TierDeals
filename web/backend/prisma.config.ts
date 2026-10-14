import 'dotenv/config';

import { defineConfig } from 'prisma/config';

/**
 * Prisma CLI configuration.
 *
 * As of Prisma 7 the datasource URL lives here rather than in schema.prisma.
 * This file is read by the CLI only (`prisma generate`, `prisma migrate`,
 * `prisma studio`); the running application gets its connection from the
 * driver adapter in src/lib/prisma.ts, which reads the same validated
 * DATABASE_URL.
 *
 * `.env` is not loaded automatically for config files, hence the import above.
 */

/**
 * Deliberately read straight from process.env rather than through Prisma's
 * `env()` helper, which throws when the variable is absent.
 *
 * `prisma generate` needs no database at all, and it runs on `npm install` --
 * including on a fresh clone and in CI, before any .env exists. Making the
 * datasource conditional keeps `generate` working there while still letting
 * `migrate` fail with Prisma's own clear message when the URL is genuinely
 * required but missing.
 */
const databaseUrl = process.env.DATABASE_URL;

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
  },
  ...(databaseUrl === undefined ? {} : { datasource: { url: databaseUrl } }),
});
