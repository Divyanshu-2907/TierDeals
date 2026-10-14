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
 * The configured Shopify app: authentication, session storage and webhook
 * plumbing.
 *
 * Authentication is token exchange. Shopify installs the app itself from the
 * scopes in shopify.app.toml (managed installation), and the admin UI sends an
 * App Bridge session token with every API request. The first request from a
 * shop without a stored session swaps that token for an offline access token,
 * with no OAuth redirects. The library rejects the auth routes in this mode,
 * so none are mounted.
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
  // Still required by the library's config type, but unused under token
  // exchange: requests to these paths are never routed to it.
  auth: {
    path: '/api/auth',
    callbackPath: '/api/auth/callback',
  },
  webhooks: {
    path: '/api/webhooks',
  },
  sessionStorage: new PostgreSQLSessionStorage(new URL(env.DATABASE_URL)),
  useOnlineTokens: false,
  future: {
    tokenExchange: true,
  },
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
