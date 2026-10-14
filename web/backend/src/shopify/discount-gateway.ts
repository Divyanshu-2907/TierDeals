import type { RuleConfig, RuleType } from '@tierdeals/shared';

import type { AdminGraphql } from './admin-graphql.js';

/** `handle` in extensions/tierdeals-discount/shopify.extension.toml. */
export const FUNCTION_HANDLE = 'tierdeals-discount';

/** Where the Function reads its config; see the extension's input queries. */
export const RULE_CONFIG_NAMESPACE = '$app:tierdeals';
export const RULE_CONFIG_KEY = 'rule-config';

/** Everything about a rule that the Shopify discount mirrors. */
export interface DiscountSnapshot {
  title: string;
  type: RuleType;
  config: RuleConfig;
  active: boolean;
  startsAt: Date;
  endsAt: Date | null;
  combinesWith: {
    productDiscounts: boolean;
    orderDiscounts: boolean;
    shippingDiscounts: boolean;
  };
  /** Null until the discount has been created in Shopify. */
  shopifyDiscountId: string | null;
}

export interface DiscountGateway {
  /**
   * Makes the Shopify discount match `rule`, creating it if it does not exist
   * yet, and returns its ID.
   *
   * Pushes the whole rule every time, so calling it again after a failure is
   * always safe. `onCreated` runs as soon as a new discount exists, before
   * any later step can fail, so the caller can record the ID and a retry
   * updates that discount instead of creating a duplicate.
   */
  push(rule: DiscountSnapshot, onCreated: (discountId: string) => Promise<void>): Promise<string>;

  /** Deletes the discount. One that no longer exists counts as deleted. */
  remove(discountId: string): Promise<void>;
}

/** A `userErrors` entry from a Shopify mutation. */
export interface ShopifyUserErrorDetail {
  field?: readonly string[] | null;
  message: string;
  code?: string | null;
}

/**
 * Shopify understood the request and refused it, for example because the
 * shop has reached its limit of app discounts. The message is meant for the
 * merchant.
 */
export class ShopifyUserError extends Error {
  constructor(
    readonly operation: string,
    readonly userErrors: readonly ShopifyUserErrorDetail[],
  ) {
    super(userErrors.map((e) => e.message).join(' '));
    this.name = 'ShopifyUserError';
  }
}

const DISCOUNT_CLASS: Record<RuleType, 'PRODUCT' | 'ORDER' | 'SHIPPING'> = {
  COLLECTION_QUANTITY_TIERS: 'PRODUCT',
  CART_SUBTOTAL_TIERS: 'ORDER',
  FREE_SHIPPING_THRESHOLD: 'SHIPPING',
};

/** The discount class a rule type needs; the Function only acts within it. */
export function discountClassFor(type: RuleType): 'PRODUCT' | 'ORDER' | 'SHIPPING' {
  return DISCOUNT_CLASS[type];
}

interface UserErrorsPayload {
  userErrors: ShopifyUserErrorDetail[];
}

const CREATE = `#graphql
  mutation TierDealsDiscountCreate($discount: DiscountAutomaticAppInput!) {
    discountAutomaticAppCreate(automaticAppDiscount: $discount) {
      automaticAppDiscount { discountId }
      userErrors { field message code }
    }
  }`;

const UPDATE = `#graphql
  mutation TierDealsDiscountUpdate($id: ID!, $discount: DiscountAutomaticAppInput!) {
    discountAutomaticAppUpdate(id: $id, automaticAppDiscount: $discount) {
      automaticAppDiscount { discountId }
      userErrors { field message code }
    }
  }`;

const SET_CONFIG = `#graphql
  mutation TierDealsDiscountConfigSet($metafields: [MetafieldsSetInput!]!) {
    metafieldsSet(metafields: $metafields) {
      metafields { id }
      userErrors { field message code }
    }
  }`;

const DEACTIVATE = `#graphql
  mutation TierDealsDiscountDeactivate($id: ID!) {
    discountAutomaticDeactivate(id: $id) {
      userErrors { field message code }
    }
  }`;

const DELETE = `#graphql
  mutation TierDealsDiscountDelete($id: ID!) {
    discountAutomaticDelete(id: $id) {
      deletedAutomaticDiscountId
      userErrors { field message code }
    }
  }`;

const EXISTS = `#graphql
  query TierDealsDiscountExists($id: ID!) {
    discountNode(id: $id) { id }
  }`;

/** A DiscountGateway backed by the Shopify Admin GraphQL API. */
export function createShopifyDiscountGateway(graphql: AdminGraphql): DiscountGateway {
  async function mutate<TPayload extends UserErrorsPayload>(
    operation: string,
    query: string,
    variables: Record<string, unknown>,
  ): Promise<TPayload> {
    const { data } = await graphql.request<Record<string, TPayload | null>>(query, { variables });
    const payload = data?.[operation];
    if (!payload) {
      throw new Error(`Shopify returned no ${operation} payload.`);
    }
    if (payload.userErrors.length > 0) {
      throw new ShopifyUserError(operation, payload.userErrors);
    }
    return payload;
  }

  /** Fields shared by create and update. Dates are re-sent every time. */
  function discountFields(rule: DiscountSnapshot) {
    return {
      title: rule.title,
      startsAt: rule.startsAt.toISOString(),
      endsAt: rule.endsAt?.toISOString() ?? null,
      combinesWith: rule.combinesWith,
    };
  }

  function configMetafield(rule: DiscountSnapshot) {
    return {
      namespace: RULE_CONFIG_NAMESPACE,
      key: RULE_CONFIG_KEY,
      type: 'json',
      value: JSON.stringify(rule.config),
    };
  }

  return {
    async push(rule, onCreated) {
      let discountId = rule.shopifyDiscountId;

      if (discountId === null) {
        const created = await mutate<
          UserErrorsPayload & {
            automaticAppDiscount: { discountId: string } | null;
          }
        >('discountAutomaticAppCreate', CREATE, {
          discount: {
            ...discountFields(rule),
            functionHandle: FUNCTION_HANDLE,
            discountClasses: [discountClassFor(rule.type)],
            metafields: [configMetafield(rule)],
          },
        });
        const newId = created.automaticAppDiscount?.discountId;
        if (!newId) {
          throw new Error('Shopify created the discount but returned no ID.');
        }
        discountId = newId;
        await onCreated(discountId);
      } else {
        // The function and discount class are fixed at creation (a rule's
        // type cannot change), so only the editable fields are sent.
        await mutate('discountAutomaticAppUpdate', UPDATE, {
          id: discountId,
          discount: discountFields(rule),
        });
        // metafieldsSet upserts by namespace and key, so it is safe to repeat.
        await mutate('metafieldsSet', SET_CONFIG, {
          metafields: [{ ...configMetafield(rule), ownerId: discountId }],
        });
      }

      // An update with the rule's own dates reopens a deactivated discount,
      // so only switching off needs a separate call.
      if (!rule.active) {
        await mutate('discountAutomaticDeactivate', DEACTIVATE, { id: discountId });
      }

      return discountId;
    },

    async remove(discountId) {
      try {
        await mutate('discountAutomaticDelete', DELETE, { id: discountId });
      } catch (error) {
        // If the merchant already deleted it in the Shopify admin, the goal
        // is met. Check rather than guess from the error wording.
        if (error instanceof ShopifyUserError) {
          const { data } = await graphql.request<{ discountNode: { id: string } | null }>(EXISTS, {
            variables: { id: discountId },
          });
          if (data?.discountNode === null) return;
        }
        throw error;
      }
    },
  };
}
