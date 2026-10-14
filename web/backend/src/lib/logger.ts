import { pino, type Logger } from 'pino';

import { env } from '../config/env.js';

/**
 * Application logger.
 *
 * Structured JSON in production so a log pipeline can index it; pretty-printed
 * locally so it is readable while developing. Secrets are redacted centrally
 * rather than trusting every call site to remember.
 */
export const logger: Logger = pino({
  level: env.LOG_LEVEL,
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers.cookie',
      'req.headers["x-shopify-hmac-sha256"]',
      'res.headers["set-cookie"]',
      '*.accessToken',
      '*.apiSecretKey',
      'SHOPIFY_API_SECRET',
    ],
    censor: '[redacted]',
  },
  // Pretty output is a dev-only convenience; production emits newline-delimited JSON.
  ...(env.isProduction || env.isTest
    ? {}
    : {
        transport: {
          target: 'pino-pretty',
          options: { colorize: true, translateTime: 'HH:MM:ss.l', ignore: 'pid,hostname' },
        },
      }),
});

/** Child logger tagged with a subsystem name, e.g. `createLogger('shopify')`. */
export function createLogger(name: string): Logger {
  return logger.child({ name });
}
