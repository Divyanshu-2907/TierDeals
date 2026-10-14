import { execSync } from 'node:child_process';

import { TEST_DATABASE_URL } from './test-database.js';

/**
 * Brings the test database up to the latest migration before any test runs.
 * `prisma migrate deploy` also creates the database if it does not exist yet.
 * Needs Postgres running (`npm run db:up`).
 */
export default function setup(): void {
  execSync('npx prisma migrate deploy', {
    env: { ...process.env, DATABASE_URL: TEST_DATABASE_URL },
    stdio: 'pipe',
  });
}
