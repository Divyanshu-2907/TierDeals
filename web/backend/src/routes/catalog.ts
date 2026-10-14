import { Router, type Request, type Response } from 'express';
import { z } from 'zod';

import { getSession } from '../lib/shopify.js';
import { ValidationError } from '../lib/errors.js';
import type { Catalog } from '../shopify/catalog.js';

/** Matches the limit on a rule's collections. */
const MAX_IDS = 100;

const collectionIdsQuery = z.object({
  ids: z
    .string()
    .transform((value) => value.split(',').filter((id) => id.length > 0))
    .pipe(z.array(z.string().regex(/^gid:\/\/shopify\/Collection\/\d+$/)).max(MAX_IDS)),
});

/**
 * Shop details the admin UI needs: the currency for threshold fields, and
 * collection titles for rules being edited (the resource picker supplies
 * titles for newly picked ones).
 */
export function createCatalogRouter(catalogFor: (req: Request, res: Response) => Catalog): Router {
  const router = Router();

  router.get('/shop', async (req, res) => {
    const currencyCode = await catalogFor(req, res).shopCurrency();
    res.json({ shop: getSession(res).shop, currencyCode });
  });

  router.get('/collections', async (req, res) => {
    const parsed = collectionIdsQuery.safeParse(req.query);
    if (!parsed.success) {
      throw new ValidationError(`Pass up to ${MAX_IDS} comma-separated collection GIDs as ?ids=.`);
    }
    res.json({ collections: await catalogFor(req, res).collections(parsed.data.ids) });
  });

  return router;
}
