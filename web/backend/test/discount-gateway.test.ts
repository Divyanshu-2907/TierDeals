import { describe, expect, it, vi } from 'vitest';

import type { AdminGraphql } from '../src/shopify/admin-graphql.js';
import {
  ShopifyUserError,
  createShopifyDiscountGateway,
  type DiscountSnapshot,
} from '../src/shopify/discount-gateway.js';

interface Call {
  operation: string;
  variables: Record<string, unknown> | undefined;
}

/**
 * A fake Admin GraphQL client. Each response is keyed by the operation name
 * found in the query (e.g. "discountAutomaticAppCreate").
 */
function fakeGraphql(responses: Record<string, unknown>) {
  const calls: Call[] = [];
  const graphql: AdminGraphql = {
    request<TData>(query: string, options?: { variables?: Record<string, unknown> }) {
      const operation = Object.keys(responses).find((name) => query.includes(`${name}(`));
      if (operation === undefined) throw new Error(`No fake response for query: ${query}`);
      calls.push({ operation, variables: options?.variables });
      return Promise.resolve({ data: { [operation]: responses[operation] } as TData });
    },
  };
  return { graphql, calls };
}

const ok = { userErrors: [] };

const snapshot: DiscountSnapshot = {
  title: 'Buy more, save more',
  type: 'COLLECTION_QUANTITY_TIERS',
  config: {
    version: 1,
    type: 'COLLECTION_QUANTITY_TIERS',
    collectionIds: ['gid://shopify/Collection/1'],
    tiers: [{ minQuantity: 2, percentage: 10 }],
  },
  active: true,
  startsAt: new Date('2026-10-14T00:00:00Z'),
  endsAt: null,
  combinesWith: { productDiscounts: false, orderDiscounts: true, shippingDiscounts: true },
  shopifyDiscountId: null,
};

const discountId = 'gid://shopify/DiscountAutomaticNode/1';

describe('createShopifyDiscountGateway', () => {
  describe('push, for a new rule', () => {
    it('creates the discount with the function, class and config metafield', async () => {
      const { graphql, calls } = fakeGraphql({
        discountAutomaticAppCreate: { automaticAppDiscount: { discountId }, userErrors: [] },
      });
      const onCreated = vi.fn(() => Promise.resolve());

      const id = await createShopifyDiscountGateway(graphql).push(snapshot, onCreated);

      expect(id).toBe(discountId);
      expect(onCreated).toHaveBeenCalledWith(discountId);
      expect(calls).toEqual([
        {
          operation: 'discountAutomaticAppCreate',
          variables: {
            discount: {
              title: 'Buy more, save more',
              startsAt: '2026-10-14T00:00:00.000Z',
              endsAt: null,
              combinesWith: {
                productDiscounts: false,
                orderDiscounts: true,
                shippingDiscounts: true,
              },
              functionHandle: 'tierdeals-discount',
              discountClasses: ['PRODUCT'],
              metafields: [
                {
                  namespace: '$app:tierdeals',
                  key: 'rule-config',
                  type: 'json',
                  value: JSON.stringify(snapshot.config),
                },
              ],
            },
          },
        },
      ]);
    });

    it.each([
      ['CART_SUBTOTAL_TIERS', 'ORDER'],
      ['FREE_SHIPPING_THRESHOLD', 'SHIPPING'],
    ] as const)('creates a %s rule with the %s class', async (type, discountClass) => {
      const { graphql, calls } = fakeGraphql({
        discountAutomaticAppCreate: { automaticAppDiscount: { discountId }, userErrors: [] },
      });

      await createShopifyDiscountGateway(graphql).push({ ...snapshot, type }, () =>
        Promise.resolve(),
      );

      expect(calls[0]?.variables).toMatchObject({ discount: { discountClasses: [discountClass] } });
    });

    it('deactivates a new rule that is switched off, after reporting its ID', async () => {
      const { graphql, calls } = fakeGraphql({
        discountAutomaticAppCreate: { automaticAppDiscount: { discountId }, userErrors: [] },
        discountAutomaticDeactivate: ok,
      });
      const onCreated = vi.fn(() => Promise.resolve());

      await createShopifyDiscountGateway(graphql).push({ ...snapshot, active: false }, onCreated);

      expect(calls.map((c) => c.operation)).toEqual([
        'discountAutomaticAppCreate',
        'discountAutomaticDeactivate',
      ]);
      expect(onCreated).toHaveBeenCalledOnce();
    });

    it('reports the new ID even when a later step fails, so a retry does not duplicate it', async () => {
      const { graphql } = fakeGraphql({
        discountAutomaticAppCreate: { automaticAppDiscount: { discountId }, userErrors: [] },
        discountAutomaticDeactivate: { userErrors: [{ field: null, message: 'Try again later.' }] },
      });
      const onCreated = vi.fn(() => Promise.resolve());

      await expect(
        createShopifyDiscountGateway(graphql).push({ ...snapshot, active: false }, onCreated),
      ).rejects.toBeInstanceOf(ShopifyUserError);
      expect(onCreated).toHaveBeenCalledWith(discountId);
    });

    it('turns userErrors into a ShopifyUserError with the merchant-facing message', async () => {
      const { graphql } = fakeGraphql({
        discountAutomaticAppCreate: {
          automaticAppDiscount: null,
          userErrors: [
            {
              field: ['automaticAppDiscount'],
              message: 'You have reached the maximum number of app discounts.',
              code: 'MAX_APP_DISCOUNTS',
            },
          ],
        },
      });

      const push = createShopifyDiscountGateway(graphql).push(snapshot, () => Promise.resolve());

      await expect(push).rejects.toThrow('You have reached the maximum number of app discounts.');
      await expect(push).rejects.toMatchObject({
        operation: 'discountAutomaticAppCreate',
        userErrors: [expect.objectContaining({ code: 'MAX_APP_DISCOUNTS' })],
      });
    });
  });

  describe('push, for an existing rule', () => {
    const existing = { ...snapshot, shopifyDiscountId: discountId };

    it('updates the discount fields, then upserts the config metafield', async () => {
      const { graphql, calls } = fakeGraphql({
        discountAutomaticAppUpdate: { automaticAppDiscount: { discountId }, userErrors: [] },
        metafieldsSet: { metafields: [{ id: 'gid://shopify/Metafield/1' }], userErrors: [] },
      });
      const onCreated = vi.fn(() => Promise.resolve());

      const id = await createShopifyDiscountGateway(graphql).push(existing, onCreated);

      expect(id).toBe(discountId);
      expect(onCreated).not.toHaveBeenCalled();
      expect(calls).toEqual([
        {
          operation: 'discountAutomaticAppUpdate',
          variables: {
            id: discountId,
            discount: {
              title: 'Buy more, save more',
              startsAt: '2026-10-14T00:00:00.000Z',
              endsAt: null,
              combinesWith: {
                productDiscounts: false,
                orderDiscounts: true,
                shippingDiscounts: true,
              },
            },
          },
        },
        {
          operation: 'metafieldsSet',
          variables: {
            metafields: [
              {
                namespace: '$app:tierdeals',
                key: 'rule-config',
                type: 'json',
                value: JSON.stringify(snapshot.config),
                ownerId: discountId,
              },
            ],
          },
        },
      ]);
    });

    it('sends the end date when there is one', async () => {
      const { graphql, calls } = fakeGraphql({
        discountAutomaticAppUpdate: { automaticAppDiscount: { discountId }, userErrors: [] },
        metafieldsSet: { metafields: [], userErrors: [] },
      });

      await createShopifyDiscountGateway(graphql).push(
        { ...existing, endsAt: new Date('2026-12-31T23:59:59Z') },
        () => Promise.resolve(),
      );

      expect(calls[0]?.variables).toMatchObject({
        discount: { endsAt: '2026-12-31T23:59:59.000Z' },
      });
    });

    it('deactivates it when the rule is switched off', async () => {
      const { graphql, calls } = fakeGraphql({
        discountAutomaticAppUpdate: { automaticAppDiscount: { discountId }, userErrors: [] },
        metafieldsSet: { metafields: [], userErrors: [] },
        discountAutomaticDeactivate: ok,
      });

      await createShopifyDiscountGateway(graphql).push({ ...existing, active: false }, () =>
        Promise.resolve(),
      );

      expect(calls.map((c) => c.operation)).toEqual([
        'discountAutomaticAppUpdate',
        'metafieldsSet',
        'discountAutomaticDeactivate',
      ]);
    });
  });

  describe('remove', () => {
    it('deletes the discount', async () => {
      const { graphql, calls } = fakeGraphql({
        discountAutomaticDelete: { deletedAutomaticDiscountId: discountId, userErrors: [] },
      });

      await createShopifyDiscountGateway(graphql).remove(discountId);

      expect(calls).toEqual([
        { operation: 'discountAutomaticDelete', variables: { id: discountId } },
      ]);
    });

    it('treats a discount that no longer exists as deleted', async () => {
      const { graphql } = fakeGraphql({
        discountAutomaticDelete: {
          deletedAutomaticDiscountId: null,
          userErrors: [{ field: ['id'], message: 'Discount does not exist' }],
        },
        discountNode: null,
      });

      await expect(createShopifyDiscountGateway(graphql).remove(discountId)).resolves.toBe(
        undefined,
      );
    });

    it('fails when Shopify refuses to delete a discount that still exists', async () => {
      const { graphql } = fakeGraphql({
        discountAutomaticDelete: {
          deletedAutomaticDiscountId: null,
          userErrors: [{ field: null, message: 'Something went wrong.' }],
        },
        discountNode: { id: discountId },
      });

      await expect(createShopifyDiscountGateway(graphql).remove(discountId)).rejects.toThrow(
        'Something went wrong.',
      );
    });
  });
});
