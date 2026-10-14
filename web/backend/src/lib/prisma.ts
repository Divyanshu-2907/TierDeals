import { PrismaPg } from '@prisma/adapter-pg';

import { env } from '../config/env.js';
import { PrismaClient } from '../generated/prisma/client.js';

/**
 * Prisma client for application data (rules, discount applications).
 *
 * Prisma 7 talks to Postgres through a driver adapter rather than a bundled
 * query engine, so the pool below is the one real connection pool in the
 * process. Shopify's session store opens its own, separately.
 */
const adapter = new PrismaPg({ connectionString: env.DATABASE_URL });

export const prisma = new PrismaClient({
  adapter,
  log: env.isProduction ? ['warn', 'error'] : ['warn', 'error'],
});

export async function disconnectPrisma(): Promise<void> {
  await prisma.$disconnect();
}
