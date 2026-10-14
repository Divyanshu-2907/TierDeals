import type { AdminGraphql } from './admin-graphql.js';

export interface ProductSummary {
  id: string;
  title: string;
  collections: { id: string; title: string }[];
}

/** Read-only shop data the admin UI and the Rule Debugger need. */
export interface Catalog {
  /** The shop's currency, which rule thresholds are configured in. */
  shopCurrency(): Promise<string>;
  /**
   * Looks up collections by GID. IDs that no longer exist (or are not
   * collections) are left out, so the UI can flag them.
   */
  collections(ids: readonly string[]): Promise<{ id: string; title: string }[]>;
  /**
   * Looks up products with the collections they belong to (up to 250 each).
   * IDs that no longer exist are left out.
   */
  products(ids: readonly string[]): Promise<ProductSummary[]>;
}

/** `nodes(ids:)` accepts at most 250 IDs per query. */
const MAX_NODES = 250;

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

const PRODUCTS = `#graphql
  query TierDealsProducts($ids: [ID!]!) {
    nodes(ids: $ids) {
      ... on Product {
        id
        title
        collections(first: 250) { nodes { id title } }
      }
    }
  }`;

function chunks<T>(items: readonly T[], size: number): T[][] {
  const result: T[][] = [];
  for (let i = 0; i < items.length; i += size) result.push(items.slice(i, i + size));
  return result;
}

export function createShopifyCatalog(graphql: AdminGraphql): Catalog {
  return {
    async shopCurrency() {
      const { data } = await graphql.request<{ shop: { currencyCode: string } }>(SHOP_CURRENCY);
      if (!data) throw new Error('Shopify returned no shop data.');
      return data.shop.currencyCode;
    },

    async collections(ids) {
      const unique = [...new Set(ids)];
      const pages = await Promise.all(
        chunks(unique, MAX_NODES).map((page) =>
          graphql.request<{ nodes: ({ id?: string; title?: string } | null)[] }>(COLLECTIONS, {
            variables: { ids: page },
          }),
        ),
      );

      return pages.flatMap(({ data }) =>
        (data?.nodes ?? []).flatMap((node) =>
          node?.id !== undefined && node.title !== undefined
            ? [{ id: node.id, title: node.title }]
            : [],
        ),
      );
    },

    async products(ids) {
      const unique = [...new Set(ids)];
      const pages = await Promise.all(
        chunks(unique, MAX_NODES).map((page) =>
          graphql.request<{
            nodes: ({
              id?: string;
              title?: string;
              collections?: { nodes: { id: string; title: string }[] };
            } | null)[];
          }>(PRODUCTS, { variables: { ids: page } }),
        ),
      );

      return pages.flatMap(({ data }) =>
        (data?.nodes ?? []).flatMap((node) =>
          node?.id !== undefined && node.title !== undefined
            ? [{ id: node.id, title: node.title, collections: node.collections?.nodes ?? [] }]
            : [],
        ),
      );
    },
  };
}
