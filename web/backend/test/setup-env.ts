/**
 * Vitest setup.
 *
 * src/config/env.ts validates the environment the moment it is imported --
 * that is the point of it. Tests therefore need a valid environment in place
 * before any src module is loaded, which is what this file provides.
 *
 * It deliberately imports nothing from src/.
 */
process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL ??= 'silent';
process.env.DATABASE_URL ??= 'postgresql://tierdeals:tierdeals@localhost:5433/tierdeals_test';
process.env.SHOPIFY_API_KEY ??= 'test-api-key';
process.env.SHOPIFY_API_SECRET ??= 'test-api-secret';
process.env.SHOPIFY_APP_URL ??= 'https://tierdeals.test';
process.env.SCOPES ??= 'write_discounts,read_discounts,read_products,read_orders';
