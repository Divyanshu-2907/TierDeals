import type { Session } from '@shopify/shopify-api';
import express, { type Express, type RequestHandler } from 'express';

import type { PrismaClient } from './generated/prisma/client.js';
import { prisma as defaultPrisma } from './lib/prisma.js';
import { getSession, shopify } from './lib/shopify.js';
import { errorHandler } from './middleware/error-handler.js';
import { notFound } from './middleware/not-found.js';
import { requestContext } from './middleware/request-context.js';
import { healthRouter } from './routes/health.js';
import { createRulesRouter } from './routes/rules.js';
import { createRuleService } from './services/rule-service.js';
import { adminGraphqlFor } from './shopify/admin-graphql.js';
import { createShopifyDiscountGateway, type DiscountGateway } from './shopify/discount-gateway.js';

/** Seams for tests; production uses the defaults. */
export interface AppDependencies {
  prisma?: PrismaClient;
  /** Authenticates /api requests and puts the session in res.locals.shopify. */
  authenticate?: RequestHandler;
  /** The Shopify discount gateway for an authenticated session. */
  discountGatewayFor?: (session: Session) => DiscountGateway;
}

/**
 * Builds the Express application.
 *
 * Exported as a factory rather than a module-level singleton so tests can
 * spin up an isolated instance per suite, with fakes for Shopify.
 *
 * Middleware order matters here:
 *   1. request context, so every later log line carries a request id;
 *   2. health checks, which must answer even when Shopify is unreachable;
 *   3. the JSON body parser;
 *   4. the API, behind session validation;
 *   5. 404 then the error handler, which are always last.
 */
export function createApp(deps: AppDependencies = {}): Express {
  const prisma = deps.prisma ?? defaultPrisma;
  const authenticate = deps.authenticate ?? shopify.validateAuthenticatedSession();
  const discountGatewayFor =
    deps.discountGatewayFor ??
    ((session: Session) => createShopifyDiscountGateway(adminGraphqlFor(session)));

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
  // Every /api request carries an App Bridge session token; `authenticate`
  // verifies it and, via token exchange, makes sure an offline access token is
  // stored for the shop.
  const api = express.Router();

  api.get('/me', (_req, res) => {
    const session = getSession(res);
    res.json({ shop: session.shop, scopes: session.scope?.split(',') ?? [] });
  });

  api.use(
    createRulesRouter((req, res) => {
      const session = getSession(res);
      return createRuleService({
        prisma,
        shop: session.shop,
        gateway: discountGatewayFor(session),
        log: req.log,
      });
    }),
  );

  app.use('/api', authenticate, api);

  // The built admin UI is served here in production (see Phase 3 frontend).

  app.use(notFound);
  app.use(errorHandler);

  return app;
}
