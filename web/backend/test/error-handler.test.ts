import express, { type Express } from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { AppError, NotFoundError, ShopifySyncError, ValidationError } from '../src/lib/errors.js';
import { errorHandler } from '../src/middleware/error-handler.js';
import { notFound } from '../src/middleware/not-found.js';

/**
 * Builds a minimal app whose single route throws `thrown`.
 *
 * Deliberately avoids src/app.ts: this suite is about the error middleware,
 * and pulling in the real app would drag Shopify and Prisma along with it.
 */
function appThatThrows(thrown: unknown): Express {
  const app = express();
  app.get('/boom', () => {
    throw thrown;
  });
  app.get('/boom-async', async () => {
    await Promise.resolve();
    throw thrown;
  });
  app.use(notFound);
  app.use(errorHandler);
  return app;
}

describe('errorHandler', () => {
  it('maps an AppError to its status code and code', async () => {
    const app = appThatThrows(new NotFoundError('No such rule.'));

    const res = await request(app).get('/boom');

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: { code: 'not_found', message: 'No such rule.' } });
  });

  it('exposes validation details to the client', async () => {
    const app = appThatThrows(new ValidationError('Bad tiers.', [{ path: ['tiers', 0] }]));

    const res = await request(app).get('/boom');

    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('validation_error');
    expect(res.body.error.details).toEqual([{ path: ['tiers', 0] }]);
  });

  it('converts a stray ZodError into a 422', async () => {
    const parse = () => z.object({ n: z.number() }).parse({ n: 'nope' });
    let thrown: unknown;
    try {
      parse();
    } catch (err) {
      thrown = err;
    }
    const app = appThatThrows(thrown);

    const res = await request(app).get('/boom');

    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('validation_error');
  });

  it('hides the message of an unexpected error', async () => {
    const app = appThatThrows(new Error('connection string: postgres://user:hunter2@db'));

    const res = await request(app).get('/boom');

    expect(res.status).toBe(500);
    expect(res.body.error.code).toBe('internal_error');
    expect(res.body.error.message).toBe('An unexpected error occurred.');
    expect(JSON.stringify(res.body)).not.toContain('hunter2');
  });

  it('hides the details of a 5xx AppError but keeps the code', async () => {
    const app = appThatThrows(
      new AppError('Internal detail.', { statusCode: 503, code: 'unavailable' }),
    );

    const res = await request(app).get('/boom');

    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe('unavailable');
    expect(res.body.error.message).toBe('An unexpected error occurred.');
  });

  it('exposes a ShopifySyncError, which the merchant is meant to see', async () => {
    const app = appThatThrows(new ShopifySyncError('Shopify rejected the discount.', 'rule_1'));

    const res = await request(app).get('/boom');

    expect(res.status).toBe(502);
    expect(res.body.error.code).toBe('shopify_sync_error');
    expect(res.body.error.message).toBe('Shopify rejected the discount.');
  });

  it('catches errors thrown from async handlers (Express 5)', async () => {
    const app = appThatThrows(new NotFoundError('Gone.'));

    const res = await request(app).get('/boom-async');

    expect(res.status).toBe(404);
  });

  it('returns a 404 for an unmatched route', async () => {
    const app = appThatThrows(new Error('unused'));

    const res = await request(app).get('/nothing-here');

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('not_found');
    expect(res.body.error.message).toContain('GET /nothing-here');
  });
});
