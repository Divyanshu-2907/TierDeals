import type { Session } from '@shopify/shopify-api';
import type { Logger } from 'pino';

declare global {
  namespace Express {
    /** Added by `pino-http` (see src/middleware/request-context.ts). */
    interface Request {
      id: string;
      log: Logger;
    }

    /**
     * Added by `shopify.validateAuthenticatedSession()` and
     * `shopify.ensureInstalledOnShop()`.
     *
     * @shopify/shopify-app-express writes the authenticated session here but
     * ships no type augmentation for it, so `res.locals.shopify` would
     * otherwise be `any` and silently defeat strict mode. Declaring the shape
     * once, here, is what lets `getSession()` be genuinely type-safe.
     */
    interface Locals {
      shopify?: {
        session?: Session;
      };
    }
  }
}

export {};
