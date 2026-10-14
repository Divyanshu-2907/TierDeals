// Must be the first import: it populates process.env from .env before
// ./config/env.js (pulled in transitively below) validates it.
import 'dotenv/config';

import { createApp } from './app.js';
import { env } from './config/env.js';
import { logger } from './lib/logger.js';
import { disconnectPrisma } from './lib/prisma.js';

const app = createApp();

const server = app.listen(env.PORT, () => {
  logger.info(
    { port: env.PORT, appUrl: env.SHOPIFY_APP_URL, env: env.NODE_ENV },
    'TierDeals backend listening',
  );
});

/**
 * Graceful shutdown: stop accepting connections, let in-flight requests
 * finish, then close the database pool. `shopify app dev` restarts the
 * process often, so a clean exit keeps Postgres connections from leaking.
 */
async function shutdown(signal: NodeJS.Signals): Promise<void> {
  logger.info({ signal }, 'Shutting down');

  server.close((err) => {
    if (err) logger.error({ err }, 'Error while closing the HTTP server');
  });

  try {
    await disconnectPrisma();
  } catch (err) {
    logger.error({ err }, 'Error while disconnecting Prisma');
  }

  process.exit(0);
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    void shutdown(signal);
  });
}

process.on('unhandledRejection', (reason) => {
  logger.error({ err: reason }, 'Unhandled promise rejection');
});
