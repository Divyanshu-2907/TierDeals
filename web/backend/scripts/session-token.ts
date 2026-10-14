/**
 * Mints a short-lived Shopify session token for calling the /api routes from a
 * terminal, e.g. to check /api/me before the embedded admin UI exists.
 *
 * In the real app App Bridge issues these tokens inside the Shopify admin; this
 * script signs an equivalent JWT with the app secret from .env, so it works
 * only for shops that have already installed the app.
 *
 * Usage (from the repository root):
 *   npx tsx web/backend/scripts/session-token.ts your-store.myshopify.com
 *
 * Development only. Never point it at a production secret.
 */
import '../src/config/load-env.js';

import { createHmac, randomUUID } from 'node:crypto';

const TOKEN_LIFETIME_SECONDS = 60;

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

function base64url(value: string | Buffer): string {
  return Buffer.from(value).toString('base64url');
}

const shop = process.argv[2];
if (!shop || !/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(shop)) {
  fail('Usage: npx tsx web/backend/scripts/session-token.ts <shop>.myshopify.com');
}

const apiKey = process.env.SHOPIFY_API_KEY;
const apiSecret = process.env.SHOPIFY_API_SECRET;
if (!apiKey || !apiSecret) {
  fail('SHOPIFY_API_KEY and SHOPIFY_API_SECRET must be set in .env (see `shopify app env show`).');
}

const now = Math.floor(Date.now() / 1000);

// Same claims App Bridge puts in a real session token.
const payload = {
  iss: `https://${shop}/admin`,
  dest: `https://${shop}`,
  aud: apiKey,
  sub: '1',
  exp: now + TOKEN_LIFETIME_SECONDS,
  nbf: now,
  iat: now,
  jti: randomUUID(),
  sid: randomUUID(),
};

const signingInput = `${base64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))}.${base64url(JSON.stringify(payload))}`;
const signature = createHmac('sha256', apiSecret).update(signingInput).digest('base64url');

process.stdout.write(`${signingInput}.${signature}\n`);
