import type { Session } from '@shopify/shopify-api';

import { shopify } from '../lib/shopify.js';

/**
 * The slice of the Shopify Admin GraphQL client the app uses.
 *
 * Narrower than the library's client on purpose: services depend on this, so
 * tests can hand them a fake that records queries and returns canned data.
 * Like the real client, `request` throws on HTTP and top-level GraphQL errors;
 * mutation `userErrors` come back as ordinary data.
 */
export interface AdminGraphql {
  request<TData>(
    query: string,
    options?: { variables?: Record<string, unknown> },
  ): Promise<{ data?: TData | undefined }>;
}

/** An Admin GraphQL client authenticated as the session's shop. */
export function adminGraphqlFor(session: Session): AdminGraphql {
  const client = new shopify.api.clients.Graphql({ session });

  return {
    async request<TData>(query: string, options?: { variables?: Record<string, unknown> }) {
      const response = await client.request<TData>(query, options);
      return { data: response.data };
    },
  };
}
