import { debugCartSchema, fieldErrors } from '@tierdeals/shared';
import { Router, type Request, type Response } from 'express';

import { ValidationError } from '../lib/errors.js';
import type { createDebuggerService } from '../services/debugger-service.js';

type DebuggerService = ReturnType<typeof createDebuggerService>;

/** POST /api/debugger/evaluate: every rule against a sample cart. */
export function createDebuggerRouter(
  serviceFor: (req: Request, res: Response) => DebuggerService,
): Router {
  const router = Router();

  router.post('/debugger/evaluate', async (req, res) => {
    const parsed = debugCartSchema.safeParse((req.body as { cart?: unknown } | undefined)?.cart);
    if (!parsed.success) {
      throw new ValidationError('The sample cart has errors.', {
        fields: fieldErrors(parsed.error.issues),
      });
    }
    res.json({ result: await serviceFor(req, res).evaluate(parsed.data) });
  });

  return router;
}
