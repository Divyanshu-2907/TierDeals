import { ApiVersion, type Session } from '@shopify/shopify-api';
import { shopifyApp, type ShopifyApp } from '@shopify/shopify-app-express';
import { PostgreSQLSessionStorage } from '@shopify/shopify-app-session-storage-postgresql';

import type { Response } from 'express';

import { env } from '../config/env.js';
import { UnauthorizedError } from './errors.js';

/**
 * The Admin API version this app speaks.
 *
 * Pinned deliberately. `LATEST_API_VERSION` was removed from the SDK in v12
 * precisely so that a dependency bump cannot silently move an app onto a new
 * API version. Bumping this is a conscious edit, paired with re-reading the
 * changelog and updating the `api_version` in the Function extension's
 * shopify.extension.toml to match.
 */
export const ADMIN_API_VERSION = ApiVersion.October26;

/**
 * The configured Shopify app: OAuth, session storage and webhook plumbing.
 *
 * Sessions live in the same Postgres instance as our own data but in a table
 * the adapter owns (`shopify_sessions`). It creates and migrates that table
 * itself on first use, which is why it is absent from schema.prisma.
 *
 * Offline tokens only: TierDeals acts on the shop's behalf from a background
 * webhook (Phase 5), so a token tied to a logged-in user session is no use.
 */
export const shopify: ShopifyApp = shopifyApp({
  api: {
    apiKey: env.SHOPIFY_API_KEY,
    apiSecretKey: env.SHOPIFY_API_SECRET,
    scopes: env.SCOPES,
    hostName: env.hostName,
    hostScheme: 'https',
    apiVersion: ADMIN_API_VERSION,
  },
  auth: {
    path: '/api/auth',
    callbackPath: '/api/auth/callback',
  },
  webhooks: {
    path: '/api/webhooks',
  },
  sessionStorage: new PostgreSQLSessionStorage(new URL(env.DATABASE_URL)),
  useOnlineTokens: false,
});

/**
 * The authenticated session for the current request.
 *
 * Only call this from routes mounted behind
 * `shopify.validateAuthenticatedSession()`. It throws rather than returning
 * null so handlers do not each have to re-check; the middleware above them
 * has already guaranteed a session exists, and a missing one is a wiring bug.
 */
export function getSession(res: Response): Session {
  const session = res.locals.shopify?.session;

  if (!session) {
    throw new UnauthorizedError(
      'No authenticated Shopify session on this request. Is the route mounted behind validateAuthenticatedSession()?',
    );
  }

  return session;
}
