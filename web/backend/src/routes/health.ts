import { Router } from 'express';

import { prisma } from '../lib/prisma.js';

export const healthRouter: Router = Router();

/** Liveness: the process is up. Cheap enough for a container probe. */
healthRouter.get('/health', (_req, res) => {
  res.json({ status: 'ok', uptime: process.uptime() });
});

/** Readiness: the process is up *and* can reach Postgres. */
healthRouter.get('/health/ready', async (_req, res) => {
  await prisma.$queryRaw`SELECT 1`;
  res.json({ status: 'ok', database: 'reachable' });
});
