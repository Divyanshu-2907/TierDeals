import type { ErrorRequestHandler } from 'express';
import { ZodError } from 'zod';

import { AppError, ValidationError, isAppError } from '../lib/errors.js';

/** Shape every error response in the app shares. */
export interface ErrorResponseBody {
  error: {
    code: string;
    message: string;
    requestId?: string;
    details?: unknown;
  };
}

/**
 * The one place errors become HTTP responses.
 *
 * Express 5 forwards rejected promises from async handlers here automatically,
 * so route code can just `throw` and stay readable.
 */
export const errorHandler: ErrorRequestHandler = (err, req, res, next) => {
  if (res.headersSent) {
    // Nothing useful left to say; let Express tear the connection down.
    next(err);
    return;
  }

  // A Zod failure that escaped a route is still a client-data problem.
  const normalised: AppError =
    err instanceof ZodError
      ? new ValidationError('The submitted data is invalid.', err.issues)
      : isAppError(err)
        ? err
        : new AppError('An unexpected error occurred.', { cause: err });

  const requestId = typeof req.id === 'string' ? req.id : undefined;

  // `req.log` is attached by the request-context middleware.
  const log = req.log ?? console;
  if (normalised.statusCode >= 500) {
    log.error({ err, code: normalised.code }, normalised.message);
  } else {
    log.warn({ code: normalised.code, details: normalised.details }, normalised.message);
  }

  const body: ErrorResponseBody = {
    error: {
      code: normalised.code,
      // Never leak internals: unexposed errors get a generic message.
      message: normalised.expose ? normalised.message : 'An unexpected error occurred.',
      ...(requestId === undefined ? {} : { requestId }),
      ...(normalised.expose && normalised.details !== undefined
        ? { details: normalised.details }
        : {}),
    },
  };

  res.status(normalised.statusCode).json(body);
};
