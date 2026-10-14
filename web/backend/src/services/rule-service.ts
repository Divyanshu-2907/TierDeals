import { ruleConfigSchema, ruleStatus, type RuleDto, type RuleInput } from '@tierdeals/shared';
import type { Logger } from 'pino';

import type { PrismaClient, Rule } from '../generated/prisma/client.js';
import { AppError, NotFoundError, ShopifySyncError, ValidationError } from '../lib/errors.js';
import {
  ShopifyUserError,
  type DiscountGateway,
  type DiscountSnapshot,
} from '../shopify/discount-gateway.js';

export interface RuleServiceDeps {
  prisma: PrismaClient;
  /** The shop every call is scoped to, from the authenticated session. */
  shop: string;
  gateway: DiscountGateway;
  log: Logger;
}

/**
 * Rule CRUD for one shop, keeping each rule's Shopify discount in step.
 *
 * A save spans two systems that cannot share a transaction: Postgres and the
 * Shopify Admin API. The order is always the same. Write the row first and
 * mark it PENDING, push the whole rule to Shopify, then record the outcome
 * as SYNCED, or OUT_OF_SYNC with a reason the merchant can act on. The
 * merchant's edit is never lost to a Shopify outage, the list shows exactly
 * which rules Shopify does not match yet, and a retry re-runs the same
 * idempotent push.
 */
export function createRuleService({ prisma, shop, gateway, log }: RuleServiceDeps) {
  async function findOwned(id: string): Promise<Rule> {
    const rule = await prisma.rule.findFirst({ where: { id, shop } });
    if (!rule) throw new NotFoundError('Rule not found.');
    return rule;
  }

  /** Pushes `rule` to Shopify and records the outcome on the row. */
  async function sync(rule: Rule): Promise<Rule> {
    try {
      const discountId = await gateway.push(toSnapshot(rule), async (createdId) => {
        // Saved before anything else can fail, so a retry updates this
        // discount instead of creating a second one.
        await prisma.rule.update({
          where: { id: rule.id },
          data: { shopifyDiscountId: createdId },
        });
      });

      return await prisma.rule.update({
        where: { id: rule.id },
        data: {
          shopifyDiscountId: discountId,
          syncStatus: 'SYNCED',
          syncError: null,
          lastSyncedAt: new Date(),
        },
      });
    } catch (error) {
      log.warn({ err: error, ruleId: rule.id }, 'Shopify sync failed; rule marked out of sync');
      return prisma.rule.update({
        where: { id: rule.id },
        data: { syncStatus: 'OUT_OF_SYNC', syncError: describeSyncFailure(error) },
      });
    }
  }

  return {
    async list(): Promise<RuleDto[]> {
      const rules = await prisma.rule.findMany({ where: { shop }, orderBy: { createdAt: 'desc' } });
      const now = new Date();
      return rules.map((rule) => toDto(rule, now));
    },

    async get(id: string): Promise<RuleDto> {
      return toDto(await findOwned(id));
    },

    async create(input: RuleInput): Promise<RuleDto> {
      const rule = await prisma.rule.create({
        data: { shop, ...fromInput(input), syncStatus: 'PENDING' },
      });
      return toDto(await sync(rule));
    },

    async update(id: string, input: RuleInput): Promise<RuleDto> {
      const existing = await findOwned(id);
      if (input.config.type !== existing.type) {
        // The Shopify discount's class is fixed when it is created.
        throw new ValidationError('A rule’s type cannot be changed.', {
          fields: { 'config.type': 'A rule’s type cannot be changed. Create a new rule instead.' },
        });
      }

      const rule = await prisma.rule.update({
        where: { id: existing.id },
        data: { ...fromInput(input), syncStatus: 'PENDING' },
      });
      return toDto(await sync(rule));
    },

    async setActive(id: string, active: boolean): Promise<RuleDto> {
      const existing = await findOwned(id);
      const rule = await prisma.rule.update({
        where: { id: existing.id },
        data: { active, syncStatus: 'PENDING' },
      });
      return toDto(await sync(rule));
    },

    /** Re-pushes a rule as it is, e.g. after an earlier sync failed. */
    async retrySync(id: string): Promise<RuleDto> {
      return toDto(await sync(await findOwned(id)));
    },

    /**
     * Deletes the Shopify discount, then the rule. If Shopify refuses, the
     * rule is kept (a discount with no rule behind it could not be managed
     * from TierDeals any more) and marked out of sync with the reason.
     */
    async remove(id: string): Promise<void> {
      const rule = await findOwned(id);

      if (rule.shopifyDiscountId !== null) {
        try {
          await gateway.remove(rule.shopifyDiscountId);
        } catch (error) {
          const reason = describeSyncFailure(error);
          log.warn({ err: error, ruleId: rule.id }, 'Could not delete the Shopify discount');
          await prisma.rule.update({
            where: { id: rule.id },
            data: {
              syncStatus: 'OUT_OF_SYNC',
              syncError: `Could not delete from Shopify: ${reason}`,
            },
          });
          throw new ShopifySyncError(
            `The rule was not deleted because Shopify refused to delete its discount: ${reason}`,
            rule.id,
            error,
          );
        }
      }

      await prisma.rule.delete({ where: { id: rule.id } });
    },
  };
}

export type RuleService = ReturnType<typeof createRuleService>;

function fromInput(input: RuleInput) {
  return {
    title: input.title,
    type: input.config.type,
    config: input.config,
    active: input.active,
    startsAt: new Date(input.startsAt),
    endsAt: input.endsAt === null ? null : new Date(input.endsAt),
    combinesWithProductDiscounts: input.combinesWith.productDiscounts,
    combinesWithOrderDiscounts: input.combinesWith.orderDiscounts,
    combinesWithShippingDiscounts: input.combinesWith.shippingDiscounts,
  };
}

/**
 * Re-validates the stored config on the way out, so a row edited by hand (or
 * written by an older version) fails loudly here instead of being pushed to
 * Shopify or shown to the merchant in a shape the form cannot handle.
 */
function parseStoredConfig(rule: Rule) {
  const result = ruleConfigSchema.safeParse(rule.config);
  if (!result.success) {
    throw new AppError(`Rule ${rule.id} has an invalid stored config.`, { cause: result.error });
  }
  return result.data;
}

function toSnapshot(rule: Rule): DiscountSnapshot {
  return {
    title: rule.title,
    type: rule.type,
    config: parseStoredConfig(rule),
    active: rule.active,
    startsAt: rule.startsAt,
    endsAt: rule.endsAt,
    combinesWith: {
      productDiscounts: rule.combinesWithProductDiscounts,
      orderDiscounts: rule.combinesWithOrderDiscounts,
      shippingDiscounts: rule.combinesWithShippingDiscounts,
    },
    shopifyDiscountId: rule.shopifyDiscountId,
  };
}

export function toDto(rule: Rule, now: Date = new Date()): RuleDto {
  return {
    id: rule.id,
    title: rule.title,
    type: rule.type,
    config: parseStoredConfig(rule),
    active: rule.active,
    startsAt: rule.startsAt.toISOString(),
    endsAt: rule.endsAt?.toISOString() ?? null,
    combinesWith: {
      productDiscounts: rule.combinesWithProductDiscounts,
      orderDiscounts: rule.combinesWithOrderDiscounts,
      shippingDiscounts: rule.combinesWithShippingDiscounts,
    },
    status: ruleStatus(rule, now),
    sync: {
      status: rule.syncStatus,
      error: rule.syncError,
      shopifyDiscountId: rule.shopifyDiscountId,
      lastSyncedAt: rule.lastSyncedAt?.toISOString() ?? null,
    },
    createdAt: rule.createdAt.toISOString(),
    updatedAt: rule.updatedAt.toISOString(),
  };
}

/**
 * Turns a failed push into a message for the merchant. Shopify's own
 * user-error messages are written for merchants and passed through; anything
 * else (network trouble, an expired token) gets a generic message, and the
 * details go to the log.
 */
export function describeSyncFailure(error: unknown): string {
  if (error instanceof ShopifyUserError) {
    return `Shopify rejected the change: ${error.message}`;
  }
  return 'Shopify could not be reached or returned an unexpected error. Try syncing again.';
}
