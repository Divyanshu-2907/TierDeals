import { describe, expect, it } from 'vitest';

import { fieldErrors, ruleConfigSchema, type RuleConfig } from '../src/index.js';

const collectionConfig = {
  version: 1,
  type: 'COLLECTION_QUANTITY_TIERS',
  collectionIds: ['gid://shopify/Collection/1'],
  tiers: [
    { minQuantity: 2, percentage: 10 },
    { minQuantity: 3, percentage: 15 },
  ],
} satisfies RuleConfig;

const subtotalConfig = {
  version: 1,
  type: 'CART_SUBTOTAL_TIERS',
  tiers: [{ minSubtotal: 50, percentage: 5 }],
} satisfies RuleConfig;

const shippingConfig = {
  version: 1,
  type: 'FREE_SHIPPING_THRESHOLD',
  minSubtotal: 75,
} satisfies RuleConfig;

/** Field errors for a config, keyed by dotted path. */
function errorsFor(config: unknown): Record<string, string> {
  const result = ruleConfigSchema.safeParse(config);
  if (result.success) return {};
  return fieldErrors(result.error.issues);
}

describe('ruleConfigSchema', () => {
  it.each([collectionConfig, subtotalConfig, shippingConfig])('accepts a valid $type', (config) => {
    expect(ruleConfigSchema.parse(config)).toEqual(config);
  });

  it('accepts tiers in any order', () => {
    const reversed = { ...collectionConfig, tiers: [...collectionConfig.tiers].reverse() };

    expect(ruleConfigSchema.safeParse(reversed).success).toBe(true);
  });

  it('rejects an unknown type or version', () => {
    expect(ruleConfigSchema.safeParse({ ...shippingConfig, type: 'BOGO' }).success).toBe(false);
    expect(ruleConfigSchema.safeParse({ ...shippingConfig, version: 2 }).success).toBe(false);
  });

  describe('collection quantity tiers', () => {
    it('needs at least one collection, each a collection GID, without duplicates', () => {
      expect(errorsFor({ ...collectionConfig, collectionIds: [] })).toEqual({
        collectionIds: 'Choose at least one collection.',
      });
      expect(
        errorsFor({ ...collectionConfig, collectionIds: ['gid://shopify/Product/1'] }),
      ).toEqual({ 'collectionIds.0': 'Must be a collection ID.' });
      expect(
        errorsFor({
          ...collectionConfig,
          collectionIds: ['gid://shopify/Collection/1', 'gid://shopify/Collection/1'],
        }),
      ).toEqual({ collectionIds: 'Each collection can only be added once.' });
    });

    it('needs whole quantities of at least 1', () => {
      expect(
        errorsFor({ ...collectionConfig, tiers: [{ minQuantity: 1.5, percentage: 10 }] }),
      ).toEqual({ 'tiers.0.minQuantity': 'Must be a whole number.' });
      expect(
        errorsFor({ ...collectionConfig, tiers: [{ minQuantity: 0, percentage: 10 }] }),
      ).toEqual({ 'tiers.0.minQuantity': 'Must be at least 1.' });
    });
  });

  describe('tiers', () => {
    it('need a percentage above 0 and at most 100', () => {
      expect(errorsFor({ ...subtotalConfig, tiers: [{ minSubtotal: 50, percentage: 0 }] })).toEqual(
        {
          'tiers.0.percentage': 'Must be more than 0%.',
        },
      );
      expect(
        errorsFor({ ...subtotalConfig, tiers: [{ minSubtotal: 50, percentage: 100.5 }] }),
      ).toEqual({ 'tiers.0.percentage': 'Must be 100% or less.' });
    });

    it('allow exactly 100%', () => {
      expect(
        ruleConfigSchema.safeParse({
          ...subtotalConfig,
          tiers: [{ minSubtotal: 50, percentage: 100 }],
        }).success,
      ).toBe(true);
    });

    it('need between 1 and 10 tiers', () => {
      expect(errorsFor({ ...subtotalConfig, tiers: [] })).toEqual({
        tiers: 'Add at least one tier.',
      });

      const eleven = Array.from({ length: 11 }, (_, i) => ({
        minSubtotal: (i + 1) * 10,
        percentage: i + 1,
      }));
      expect(errorsFor({ ...subtotalConfig, tiers: eleven })).toEqual({
        tiers: 'Use at most 10 tiers.',
      });
    });

    it('reject a duplicate threshold, pointing at the later row', () => {
      expect(
        errorsFor({
          ...collectionConfig,
          tiers: [
            { minQuantity: 2, percentage: 10 },
            { minQuantity: 2, percentage: 15 },
          ],
        }),
      ).toEqual({ 'tiers.1.minQuantity': 'Another tier already uses this threshold.' });
    });

    it('reject a higher tier that does not give a bigger discount', () => {
      expect(
        errorsFor({
          ...subtotalConfig,
          tiers: [
            { minSubtotal: 100, percentage: 10 },
            { minSubtotal: 50, percentage: 10 },
          ],
        }),
      ).toEqual({
        'tiers.0.percentage': 'A higher tier must give a bigger discount than the tier below it.',
      });
    });
  });

  describe('free shipping threshold', () => {
    it('allows a zero threshold but not a negative one', () => {
      expect(ruleConfigSchema.safeParse({ ...shippingConfig, minSubtotal: 0 }).success).toBe(true);
      expect(errorsFor({ ...shippingConfig, minSubtotal: -1 })).toEqual({
        minSubtotal: 'Must not be negative.',
      });
    });
  });
});
