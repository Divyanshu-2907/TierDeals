import { randomUUID } from 'node:crypto';

import { Session } from '@shopify/shopify-api';
import type { DebugResult } from '@tierdeals/shared';
import type { RequestHandler } from 'express';
import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { createApp } from '../src/app.js';
import { prisma } from '../src/lib/prisma.js';
import type { Catalog } from '../src/shopify/catalog.js';

const HYDROGEN = 'gid://shopify/Collection/1';
const LIQUID = 'gid://shopify/Product/10';
const MINIMAL = 'gid://shopify/Product/20';

let shop: string;

const fakeAuth: RequestHandler = (_req, res, next) => {
  res.locals.shopify = {
    session: new Session({ id: `offline_${shop}`, shop, state: 'test', isOnline: false }),
  };
  next();
};

function fakeCatalog() {
  const catalog = {
    shopCurrency: vi.fn(() => Promise.resolve('INR')),
    collections: vi.fn((ids: readonly string[]) =>
      Promise.resolve(ids.filter((id) => id === HYDROGEN).map((id) => ({ id, title: 'Hydrogen' }))),
    ),
    products: vi.fn((ids: readonly string[]) =>
      Promise.resolve(
        [
          {
            id: LIQUID,
            title: 'The Collection Snowboard: Liquid',
            collections: [{ id: HYDROGEN, title: 'Hydrogen' }],
          },
          { id: MINIMAL, title: 'The Minimal Snowboard', collections: [] },
        ].filter((p) => ids.includes(p.id)),
      ),
    ),
  } satisfies Catalog;
  return catalog;
}

let catalog: ReturnType<typeof fakeCatalog>;

function app() {
  return createApp({
    authenticate: fakeAuth,
    catalogFor: () => catalog,
    discountGatewayFor: () => {
      throw new Error('the debugger must not touch discounts');
    },
  });
}

async function seedRules() {
  await prisma.rule.create({
    data: {
      shop,
      title: 'Snowboard bundle',
      type: 'COLLECTION_QUANTITY_TIERS',
      config: {
        version: 1,
        type: 'COLLECTION_QUANTITY_TIERS',
        collectionIds: [HYDROGEN],
        tiers: [
          { minQuantity: 2, percentage: 10 },
          { minQuantity: 3, percentage: 20 },
        ],
      },
      startsAt: new Date('2026-01-01T00:00:00Z'),
      syncStatus: 'SYNCED',
    },
  });
  await prisma.rule.create({
    data: {
      shop,
      title: 'Free shipping over ₹5,000',
      type: 'FREE_SHIPPING_THRESHOLD',
      config: { version: 1, type: 'FREE_SHIPPING_THRESHOLD', minSubtotal: 5000 },
      active: false,
      startsAt: new Date('2026-01-01T00:00:00Z'),
      syncStatus: 'SYNCED',
    },
  });
}

async function evaluate(cart: unknown) {
  return request(app()).post('/api/debugger/evaluate').send({ cart });
}

beforeEach(() => {
  shop = `test-debugger-${randomUUID()}.myshopify.com`;
  catalog = fakeCatalog();
});

afterAll(async () => {
  await prisma.rule.deleteMany({ where: { shop: { startsWith: 'test-debugger-' } } });
  await prisma.$disconnect();
});

describe('POST /api/debugger/evaluate', () => {
  it('evaluates every rule of the shop against the cart', async () => {
    await seedRules();

    const res = await evaluate({
      lines: [
        { productId: LIQUID, quantity: 2, unitPrice: 749.95 },
        { productId: MINIMAL, quantity: 1, unitPrice: 885.95 },
      ],
    });

    expect(res.status).toBe(200);
    const result = (res.body as { result: DebugResult }).result;
    expect(result).toMatchObject({
      shop,
      currencyCode: 'INR',
      cart: {
        subtotal: 2385.85,
        presentmentCurrencyRate: 1,
        lines: [
          {
            title: 'The Collection Snowboard: Liquid',
            lineTotal: 1499.9,
            collections: [{ id: HYDROGEN, title: 'Hydrogen' }],
          },
          { title: 'The Minimal Snowboard', collections: [] },
        ],
      },
    });
    expect(
      result.results.map((r) => ({ title: r.title, outcome: r.outcome, reason: r.reason })),
    ).toEqual(
      expect.arrayContaining([
        {
          title: 'Snowboard bundle',
          outcome: 'applied',
          reason:
            'Applied: 2 items from Hydrogen reach the 2+ tier, so 10% comes off those items. 1 more item would reach 20%.',
        },
        {
          title: 'Free shipping over ₹5,000',
          outcome: 'skipped',
          reason: 'Skipped: the rule is switched off.',
        },
      ]),
    );
    expect(result.results.find((r) => r.title === 'Snowboard bundle')).toMatchObject({
      amount: 149.99,
      discountedLines: [0],
    });
  });

  it('takes collections listed on a line as given, so pasted bug reports reproduce', async () => {
    await seedRules();

    const res = await evaluate({
      lines: [
        {
          productId: 'gid://shopify/Product/999',
          title: 'A product that was deleted since',
          quantity: 3,
          unitPrice: 100,
          collectionIds: [HYDROGEN],
        },
      ],
    });

    expect(res.status).toBe(200);
    expect(catalog.products).toHaveBeenCalledWith([]);
    const result = (res.body as { result: DebugResult }).result;
    expect(result.results.find((r) => r.title === 'Snowboard bundle')?.outcome).toBe('applied');
  });

  it('reports products that no longer exist against the right line', async () => {
    const res = await evaluate({
      lines: [
        { productId: LIQUID, quantity: 1, unitPrice: 100 },
        { productId: 'gid://shopify/Product/999', quantity: 1, unitPrice: 100 },
      ],
    });

    expect(res.status).toBe(422);
    expect(res.body).toMatchObject({
      error: { details: { fields: { 'lines.1.productId': expect.any(String) as string } } },
    });
  });

  it('rejects an invalid cart with field errors', async () => {
    const res = await evaluate({
      lines: [{ productId: 'gid://shopify/Collection/1', quantity: 0, unitPrice: -1 }],
    });

    expect(res.status).toBe(422);
    expect(res.body).toMatchObject({
      error: {
        details: {
          fields: {
            'lines.0.productId': 'Must be a product ID.',
            'lines.0.quantity': 'Must be at least 1.',
            'lines.0.unitPrice': 'Must not be negative.',
          },
        },
      },
    });
  });

  it('works for a shop with no rules and an empty cart', async () => {
    const res = await evaluate({ lines: [] });

    expect(res.status).toBe(200);
    expect((res.body as { result: DebugResult }).result).toMatchObject({
      results: [],
      notes: [],
      cart: { lines: [], subtotal: 0 },
    });
  });

  it('only sees the current shop’s rules', async () => {
    await seedRules();
    shop = `test-debugger-${randomUUID()}.myshopify.com`;

    const res = await evaluate({ lines: [] });

    expect((res.body as { result: DebugResult }).result.results).toEqual([]);
  });
});
