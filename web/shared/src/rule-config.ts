import { z } from 'zod';

/**
 * Rule configuration: the JSON stored on each Rule row and mirrored into the
 * Shopify discount's `$app:tierdeals/rule-config` metafield, where the Rust
 * Function reads it at checkout.
 *
 * This schema must accept nothing the Function would reject; see
 * extensions/tierdeals-discount/src/rule.rs, which validates the same shape.
 * It is deliberately a little stricter than the Function (unique, ascending
 * tiers) because the admin UI should stop a merchant from saving a rule that
 * is almost certainly a typo, while the Function only has to stay safe.
 */

/** Bumped together with CONFIG_VERSION in the Rust Function. */
export const RULE_CONFIG_VERSION = 1;

/** Matches MAX_TIERS in the Rust Function. */
export const MAX_TIERS = 10;

/**
 * Shopify rejects input query variable lists longer than 100, and
 * `collectionIds` is passed to the Function as one.
 */
export const MAX_COLLECTIONS = 100;

export const RULE_TYPES = [
  'COLLECTION_QUANTITY_TIERS',
  'CART_SUBTOTAL_TIERS',
  'FREE_SHIPPING_THRESHOLD',
] as const;

export type RuleType = (typeof RULE_TYPES)[number];

const percentage = z
  .number({ error: 'Enter a percentage.' })
  .gt(0, 'Must be more than 0%.')
  .lte(100, 'Must be 100% or less.');

const amount = z
  .number({ error: 'Enter an amount.' })
  .min(0, 'Must not be negative.')
  .refine(Number.isFinite, 'Enter an amount.');

const collectionId = z
  .string()
  .regex(/^gid:\/\/shopify\/Collection\/\d+$/, 'Must be a collection ID.');

const quantityTier = z.object({
  minQuantity: z
    .number({ error: 'Enter a quantity.' })
    .int('Must be a whole number.')
    .min(1, 'Must be at least 1.'),
  percentage,
});

const subtotalTier = z.object({
  minSubtotal: amount,
  percentage,
});

/**
 * Tiers must have distinct thresholds, and a higher threshold must unlock a
 * bigger discount. Issues point at the offending row so the form can show
 * them inline.
 */
function tiersSchema<T extends z.ZodType<{ percentage: number }>>(
  tier: T,
  threshold: (tier: z.infer<T>) => number,
  thresholdKey: string,
) {
  return z
    .array(tier)
    .min(1, 'Add at least one tier.')
    .max(MAX_TIERS, `Use at most ${MAX_TIERS} tiers.`)
    .superRefine((tiers, ctx) => {
      const order = tiers
        .map((t, index) => ({ index, threshold: threshold(t), percentage: t.percentage }))
        .sort((a, b) => a.threshold - b.threshold);

      for (let i = 1; i < order.length; i++) {
        const lower = order[i - 1];
        const higher = order[i];
        if (lower === undefined || higher === undefined) continue;

        if (higher.threshold === lower.threshold) {
          ctx.addIssue({
            code: 'custom',
            message: 'Another tier already uses this threshold.',
            path: [higher.index, thresholdKey],
          });
        } else if (higher.percentage <= lower.percentage) {
          ctx.addIssue({
            code: 'custom',
            message: 'A higher tier must give a bigger discount than the tier below it.',
            path: [higher.index, 'percentage'],
          });
        }
      }
    });
}

export const collectionQuantityTiersConfigSchema = z.object({
  version: z.literal(RULE_CONFIG_VERSION),
  type: z.literal('COLLECTION_QUANTITY_TIERS'),
  collectionIds: z
    .array(collectionId)
    .min(1, 'Choose at least one collection.')
    .max(MAX_COLLECTIONS, `Choose at most ${MAX_COLLECTIONS} collections.`)
    .refine((ids) => new Set(ids).size === ids.length, 'Each collection can only be added once.'),
  tiers: tiersSchema(quantityTier, (t) => t.minQuantity, 'minQuantity'),
});

export const cartSubtotalTiersConfigSchema = z.object({
  version: z.literal(RULE_CONFIG_VERSION),
  type: z.literal('CART_SUBTOTAL_TIERS'),
  tiers: tiersSchema(subtotalTier, (t) => t.minSubtotal, 'minSubtotal'),
});

export const freeShippingThresholdConfigSchema = z.object({
  version: z.literal(RULE_CONFIG_VERSION),
  type: z.literal('FREE_SHIPPING_THRESHOLD'),
  minSubtotal: amount,
});

export const ruleConfigSchema = z.discriminatedUnion('type', [
  collectionQuantityTiersConfigSchema,
  cartSubtotalTiersConfigSchema,
  freeShippingThresholdConfigSchema,
]);

export type CollectionQuantityTiersConfig = z.infer<typeof collectionQuantityTiersConfigSchema>;
export type CartSubtotalTiersConfig = z.infer<typeof cartSubtotalTiersConfigSchema>;
export type FreeShippingThresholdConfig = z.infer<typeof freeShippingThresholdConfigSchema>;
export type RuleConfig = z.infer<typeof ruleConfigSchema>;

/** Merchant-facing name for each rule type. */
export const RULE_TYPE_LABELS: Record<RuleType, string> = {
  COLLECTION_QUANTITY_TIERS: 'Collection quantity tiers',
  CART_SUBTOTAL_TIERS: 'Cart subtotal tiers',
  FREE_SHIPPING_THRESHOLD: 'Free shipping threshold',
};
