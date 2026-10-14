import { execSync } from 'node:child_process';

import { PostgreSQLSessionStorage } from '@shopify/shopify-app-session-storage-postgresql';

import { TEST_DATABASE_URL } from './test-database.js';

/**
 * Prepares the test database once, before any test file runs. Needs Postgres
 * running (`npm run db:up`, or the service container in CI).
 *
 * 1. `prisma migrate deploy` brings the app schema up to date, creating the
 *    database itself if it does not exist yet.
 * 2. Shopify's session storage creates its own tables when it is constructed,
 *    and every test file constructs it (through src/lib/shopify.ts). On an
 *    empty database, test files running in parallel would race to create the
 *    same tables, and `CREATE TABLE IF NOT EXISTS` is not safe under that
 *    concurrency in Postgres. Creating them here first removes the race.
 */
export default async function setup(): Promise<void> {
  execSync('npx prisma migrate deploy', {
    env: { ...process.env, DATABASE_URL: TEST_DATABASE_URL },
    stdio: 'pipe',
  });

  const sessions = new PostgreSQLSessionStorage(new URL(TEST_DATABASE_URL));
  await sessions.ready;
  await sessions.disconnect();
}
