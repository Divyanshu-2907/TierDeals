import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import express, { Router } from 'express';

import { env } from '../config/env.js';
import { shopify } from '../lib/shopify.js';

/**
 * Serves the built admin UI (web/frontend/dist) in production, so the app
 * runs as a single process. In development the Vite dev server does this.
 *
 * index.html is read once and gets the API key App Bridge needs, which the
 * build leaves as a placeholder so one build works for any app. Every other
 * non-API GET returns it too, so the client-side router can handle deep links
 * such as /rules/abc. Shopify's CSP headers limit which admin can frame it.
 */
export function createFrontendRouter(distDir: string): Router {
  const indexHtml = readFileSync(join(distDir, 'index.html'), 'utf8').replace(
    '%SHOPIFY_API_KEY%',
    env.SHOPIFY_API_KEY,
  );

  const router = Router();

  router.use(express.static(distDir, { index: false }));

  router.get('/{*path}', shopify.cspHeaders(), (req, res, next) => {
    if (req.path.startsWith('/api/')) {
      next();
      return;
    }
    res.type('html').send(indexHtml);
  });

  return router;
}
