import { randomUUID } from 'node:crypto';

import type { RequestHandler } from 'express';
import { pinoHttp } from 'pino-http';

import { logger } from '../lib/logger.js';

const REQUEST_ID_HEADER = 'x-request-id';

/**
 * Attaches a request id and a per-request child logger.
 *
 * An inbound `x-request-id` is honoured so a proxy or a Shopify webhook retry
 * can be traced across hops; otherwise we mint one. The id is echoed back in
 * the response header and included in error payloads, which makes "paste the
 * request id" a workable first question in a support thread.
 */
export const requestContext: RequestHandler = pinoHttp({
  logger,
  genReqId: (req, res) => {
    const existing = req.headers[REQUEST_ID_HEADER];
    const id = (Array.isArray(existing) ? existing[0] : existing) ?? randomUUID();
    res.setHeader(REQUEST_ID_HEADER, id);
    return id;
  },
  // Health checks are noisy and uninteresting; keep them at trace level.
  customLogLevel: (req, res, err) => {
    if (err !== undefined || res.statusCode >= 500) return 'error';
    if (res.statusCode >= 400) return 'warn';
    if (req.url === '/health' || req.url === '/healthz') return 'trace';
    return 'info';
  },
  customProps: (req) => ({ shop: (req.query as Record<string, unknown> | undefined)?.shop }),
});
