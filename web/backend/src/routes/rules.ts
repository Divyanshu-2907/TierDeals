import { fieldErrors, ruleActiveInputSchema, ruleInputSchema } from '@tierdeals/shared';
import { Router, type Request, type Response } from 'express';
import type { z } from 'zod';

import { ValidationError } from '../lib/errors.js';
import type { RuleService } from '../services/rule-service.js';

/** Builds the rule service for the request's authenticated shop. */
export type RuleServiceFactory = (req: Request, res: Response) => RuleService;

/**
 * Parses a request body, turning failures into a 422 whose
 * `details.fields` maps dotted paths (e.g. `config.tiers.1.percentage`) to
 * messages, which the admin form shows next to the matching input.
 */
function parseBody<T extends z.ZodType>(schema: T, body: unknown): z.infer<T> {
  const result = schema.safeParse(body);
  if (!result.success) {
    throw new ValidationError('The rule has errors. Fix them and save again.', {
      fields: fieldErrors(result.error.issues),
    });
  }
  return result.data;
}

/**
 * Rule endpoints, mounted under /api behind session validation.
 *
 * Saves respond with the rule including its sync status. A save that reached
 * Postgres but not Shopify still succeeds (the rule comes back OUT_OF_SYNC with
 * the reason), because the merchant's edit was kept and can be retried.
 */
export function createRulesRouter(serviceFor: RuleServiceFactory): Router {
  const router = Router();

  router.get('/rules', async (req, res) => {
    res.json({ rules: await serviceFor(req, res).list() });
  });

  router.get('/rules/:id', async (req, res) => {
    res.json({ rule: await serviceFor(req, res).get(req.params.id) });
  });

  router.post('/rules', async (req, res) => {
    const input = parseBody(ruleInputSchema, req.body);
    res.status(201).json({ rule: await serviceFor(req, res).create(input) });
  });

  router.put('/rules/:id', async (req, res) => {
    const input = parseBody(ruleInputSchema, req.body);
    res.json({ rule: await serviceFor(req, res).update(req.params.id, input) });
  });

  router.patch('/rules/:id/active', async (req, res) => {
    const { active } = parseBody(ruleActiveInputSchema, req.body);
    res.json({ rule: await serviceFor(req, res).setActive(req.params.id, active) });
  });

  router.post('/rules/:id/sync', async (req, res) => {
    res.json({ rule: await serviceFor(req, res).retrySync(req.params.id) });
  });

  router.delete('/rules/:id', async (req, res) => {
    await serviceFor(req, res).remove(req.params.id);
    res.status(204).end();
  });

  return router;
}
