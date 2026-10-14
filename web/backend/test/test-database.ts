/**
 * The database the tests run against. Never the development database: tests
 * create and delete rules freely. Set TEST_DATABASE_URL to use another one,
 * such as the Postgres service in CI.
 */
export const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? 'postgresql://tierdeals:tierdeals@localhost:5433/tierdeals_test';
