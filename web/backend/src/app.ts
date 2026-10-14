import express, { type Express } from 'express';

import { errorHandler } from './middleware/error-handler.js';
import { notFound } from './middleware/not-found.js';
import { requestContext } from './middleware/request-context.js';
import { healthRouter } from './routes/health.js';
import { shopify } from './lib/shopify.js';

/**
 * Builds the Express application.
 *
 * Exported as a factory rather than a module-level singleton so tests can
 * spin up an isolated instance per suite.
 *
 * Middleware order matters here:
 *   1. request context, so every later log line carries a request id;
 *   2. health checks, which must answer even when Shopify is unreachable;
 *   3. the JSON body parser;
 *   4. the API, behind session validation;
 *   5. 404 then the error handler, which are always last.
 */
export function createApp(): Express {
  const app = express();

  // Behind the Shopify CLI tunnel (and any production proxy), so trust the
  // X-Forwarded-* headers when working out the protocol and client IP.
  app.set('trust proxy', 1);
  app.disable('x-powered-by');

  app.use(requestContext);

  app.use(healthRouter);

  // Webhook processing is mounted in Phase 5, when there are handlers to
  // register. It must stay ahead of express.json(): HMAC verification needs
  // the raw request body.

  app.use(express.json({ limit: '1mb' }));

  // --- Application API ----------------------------------------------------
  // Every /api request carries an App Bridge session token; validation
  // verifies it and, via token exchange, makes sure an offline access token is
  // stored for the shop.
  const api = express.Router();
  api.get('/me', (req, res) => {
    const session = res.locals.shopify?.session;
    res.json({ shop: session?.shop ?? null, scopes: session?.scope?.split(',') ?? [] });
  });

  app.use('/api', shopify.validateAuthenticatedSession(), api);

  // The embedded admin UI is served here from Phase 3.

  app.use(notFound);
  app.use(errorHandler);

  return app;
}
