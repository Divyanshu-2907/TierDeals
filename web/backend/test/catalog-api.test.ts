import { Session } from '@shopify/shopify-api';
import type { RequestHandler } from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';

import { createApp } from '../src/app.js';
import type { AdminGraphql } from '../src/shopify/admin-graphql.js';

const shop = 'catalog-test.myshopify.com';

const fakeAuth: RequestHandler = (_req, res, next) => {
  res.locals.shopify = {
    session: new Session({ id: `offline_${shop}`, shop, state: 'test', isOnline: false }),
  };
  next();
};

/** Answers the two catalog queries; records the variables it was sent. */
function fakeGraphql() {
  const variables: unknown[] = [];
  const graphql: AdminGraphql = {
    request<TData>(query: string, options?: { variables?: Record<string, unknown> }) {
      variables.push(options?.variables);
      if (query.includes('currencyCode')) {
        return Promise.resolve({ data: { shop: { currencyCode: 'INR' } } as TData });
      }
      return Promise.resolve({
        data: {
          nodes: [
            { id: 'gid://shopify/Collection/1', title: 'Hydrogen' },
            // A deleted collection comes back as null.
            null,
          ],
        } as TData,
      });
    },
  };
  return { graphql, variables };
}

function appWith(graphql: AdminGraphql) {
  return createApp({ authenticate: fakeAuth, adminGraphqlFor: () => graphql });
}

describe('GET /api/shop', () => {
  it('returns the shop and its currency', async () => {
    const res = await request(appWith(fakeGraphql().graphql)).get('/api/shop').expect(200);

    expect(res.body).toEqual({ shop, currencyCode: 'INR' });
  });
});

describe('GET /api/collections', () => {
  it('returns the collections that still exist', async () => {
    const { graphql, variables } = fakeGraphql();

    const res = await request(appWith(graphql))
      .get('/api/collections?ids=gid://shopify/Collection/1,gid://shopify/Collection/2')
      .expect(200);

    expect(res.body).toEqual({
      collections: [{ id: 'gid://shopify/Collection/1', title: 'Hydrogen' }],
    });
    expect(variables).toEqual([
      { ids: ['gid://shopify/Collection/1', 'gid://shopify/Collection/2'] },
    ]);
  });

  it('rejects IDs that are not collection GIDs', async () => {
    await request(appWith(fakeGraphql().graphql))
      .get('/api/collections?ids=gid://shopify/Product/1')
      .expect(422);
  });

  it('does not call Shopify for an empty list', async () => {
    const { graphql, variables } = fakeGraphql();

    const res = await request(appWith(graphql)).get('/api/collections?ids=').expect(200);

    expect(res.body).toEqual({ collections: [] });
    expect(variables).toEqual([]);
  });
});
