import type { RequestHandler } from 'express';

import { NotFoundError } from '../lib/errors.js';

/** Terminal route: anything unmatched becomes a 404 AppError. */
export const notFound: RequestHandler = (req, _res, next) => {
  next(new NotFoundError(`No route matches ${req.method} ${req.path}`));
};
