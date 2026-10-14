import { describe, expect, it } from 'vitest';

import { parseEnv } from '../src/config/env.js';

/** A complete, valid environment; individual tests override one key at a time. */
const validEnv = {
  NODE_ENV: 'development',
  PORT: '3000',
  LOG_LEVEL: 'info',
  DATABASE_URL: 'postgresql://user:pass@localhost:5433/tierdeals',
  SHOPIFY_API_KEY: 'key',
  SHOPIFY_API_SECRET: 'secret',
  SHOPIFY_APP_URL: 'https://tierdeals.example.com',
  SCOPES: 'write_discounts,read_products',
} satisfies NodeJS.ProcessEnv;

describe('parseEnv', () => {
  it('accepts a complete environment', () => {
    const env = parseEnv(validEnv);

    expect(env.NODE_ENV).toBe('development');
    expect(env.PORT).toBe(3000);
    expect(env.DATABASE_URL).toBe('postgresql://user:pass@localhost:5433/tierdeals');
  });

  it('coerces PORT to a number', () => {
    expect(parseEnv({ ...validEnv, PORT: '8080' }).PORT).toBe(8080);
  });

  it('applies defaults for the optional runtime settings', () => {
    const { NODE_ENV: _node, PORT: _port, LOG_LEVEL: _level, ...rest } = validEnv;
    const env = parseEnv(rest);

    expect(env.NODE_ENV).toBe('development');
    expect(env.PORT).toBe(3000);
    expect(env.LOG_LEVEL).toBe('info');
  });

  it('splits SCOPES into a trimmed array', () => {
    const env = parseEnv({ ...validEnv, SCOPES: ' write_discounts , read_products ,, ' });

    expect(env.SCOPES).toEqual(['write_discounts', 'read_products']);
  });

  it('derives hostName from SHOPIFY_APP_URL without the scheme', () => {
    const env = parseEnv({ ...validEnv, SHOPIFY_APP_URL: 'https://abc-123.trycloudflare.com' });

    expect(env.hostName).toBe('abc-123.trycloudflare.com');
  });

  it('flags production', () => {
    expect(parseEnv({ ...validEnv, NODE_ENV: 'production' }).isProduction).toBe(true);
    expect(parseEnv(validEnv).isProduction).toBe(false);
  });

  it.each([
    ['DATABASE_URL', 'mysql://localhost/db'],
    ['SHOPIFY_APP_URL', 'not-a-url'],
    ['PORT', '70000'],
    ['NODE_ENV', 'staging'],
    ['SHOPIFY_API_KEY', ''],
    ['SCOPES', ''],
  ])('rejects an invalid %s', (key, value) => {
    expect(() => parseEnv({ ...validEnv, [key]: value })).toThrow(
      /Invalid environment configuration/,
    );
  });

  it('names the offending variable in the error message', () => {
    expect(() => parseEnv({ ...validEnv, DATABASE_URL: 'mysql://x' })).toThrow(/DATABASE_URL/);
  });
});
