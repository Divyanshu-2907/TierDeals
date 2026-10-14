import type { AdminGraphql } from './admin-graphql.js';

/** Read-only shop data the admin UI needs to describe rules. */
export interface Catalog {
  /** The shop's currency, which rule thresholds are configured in. */
  shopCurrency(): Promise<string>;
  /**
   * Looks up collections by GID. IDs that no longer exist (or are not
   * collections) are left out, so the UI can flag them.
   */
  collections(ids: readonly string[]): Promise<{ id: string; title: string }[]>;
}

const SHOP_CURRENCY = `#graphql
  query TierDealsShopCurrency {
    shop { currencyCode }
  }`;

const COLLECTIONS = `#graphql
  query TierDealsCollections($ids: [ID!]!) {
    nodes(ids: $ids) {
      ... on Collection { id title }
    }
  }`;

export function createShopifyCatalog(graphql: AdminGraphql): Catalog {
  return {
    async shopCurrency() {
      const { data } = await graphql.request<{ shop: { currencyCode: string } }>(SHOP_CURRENCY);
      if (!data) throw new Error('Shopify returned no shop data.');
      return data.shop.currencyCode;
    },

    async collections(ids) {
      if (ids.length === 0) return [];
      const { data } = await graphql.request<{
        nodes: ({ id?: string; title?: string } | null)[];
      }>(COLLECTIONS, { variables: { ids } });

      return (data?.nodes ?? []).flatMap((node) =>
        node?.id !== undefined && node.title !== undefined
          ? [{ id: node.id, title: node.title }]
          : [],
      );
    },
  };
}
