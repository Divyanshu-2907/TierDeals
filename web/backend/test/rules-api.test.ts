import { randomUUID } from 'node:crypto';

import { Session } from '@shopify/shopify-api';
import type { RuleDto, RuleInput } from '@tierdeals/shared';
import type { RequestHandler } from 'express';
import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { createApp } from '../src/app.js';
import { prisma } from '../src/lib/prisma.js';
import {
  ShopifyUserError,
  type DiscountGateway,
  type DiscountSnapshot,
} from '../src/shopify/discount-gateway.js';

/** An in-memory stand-in for Shopify's discounts, with switchable failures. */
function fakeShopify() {
  const discounts = new Map<string, DiscountSnapshot>();
  let nextId = 1;
  let failure: Error | null = null;
  let failAfterCreate = false;

  const gateway: DiscountGateway = {
    async push(rule, onCreated) {
      if (failure && !failAfterCreate) throw failure;
      let id = rule.shopifyDiscountId;
      if (id === null) {
        id = `gid://shopify/DiscountAutomaticNode/${nextId++}`;
        discounts.set(id, rule);
        await onCreated(id);
      }
      if (failure) throw failure;
      discounts.set(id, { ...rule, shopifyDiscountId: id });
      return id;
    },
    remove(id) {
      if (failure) return Promise.reject(failure);
      discounts.delete(id);
      return Promise.resolve();
    },
  };

  return {
    gateway,
    discounts,
    failWith(error: Error, options: { afterCreate?: boolean } = {}) {
      failure = error;
      failAfterCreate = options.afterCreate ?? false;
    },
    recover() {
      failure = null;
      failAfterCreate = false;
    },
  };
}

/** Stands in for session-token validation: the shop comes from a header. */
const fakeAuth: RequestHandler = (req, res, next) => {
  const shop = req.header('x-test-shop') ?? 'missing.myshopify.com';
  res.locals.shopify = {
    session: new Session({
      id: `offline_${shop}`,
      shop,
      state: 'test',
      isOnline: false,
      accessToken: 'test-token',
      scope: 'write_discounts',
    }),
  };
  next();
};

const validInput: RuleInput = {
  title: 'Buy more, save more',
  config: {
    version: 1,
    type: 'COLLECTION_QUANTITY_TIERS',
    collectionIds: ['gid://shopify/Collection/1'],
    tiers: [
      { minQuantity: 2, percentage: 10 },
      { minQuantity: 3, percentage: 15 },
    ],
  },
  active: true,
  startsAt: '2026-01-01T00:00:00.000Z',
  endsAt: null,
  combinesWith: { productDiscounts: false, orderDiscounts: true, shippingDiscounts: true },
};

let shopify: ReturnType<typeof fakeShopify>;
let shop: string;
let app: ReturnType<typeof createApp>;

/** Requests as the current test's shop. */
const api = {
  get: (path: string) => request(app).get(path).set('x-test-shop', shop),
  post: (path: string, body?: object) =>
    request(app).post(path).set('x-test-shop', shop).send(body),
  put: (path: string, body: object) => request(app).put(path).set('x-test-shop', shop).send(body),
  patch: (path: string, body: object) =>
    request(app).patch(path).set('x-test-shop', shop).send(body),
  delete: (path: string) => request(app).delete(path).set('x-test-shop', shop),
};

async function createRule(input: RuleInput = validInput): Promise<RuleDto> {
  const res = await api.post('/api/rules', input).expect(201);
  return (res.body as { rule: RuleDto }).rule;
}

beforeEach(() => {
  shopify = fakeShopify();
  // A shop per test keeps tests independent without truncating tables.
  shop = `test-${randomUUID()}.myshopify.com`;
  app = createApp({ authenticate: fakeAuth, discountGatewayFor: () => shopify.gateway });
});

afterAll(async () => {
  await prisma.rule.deleteMany({ where: { shop: { startsWith: 'test-' } } });
  await prisma.$disconnect();
});

describe('POST /api/rules', () => {
  it('saves the rule and creates its Shopify discount', async () => {
    const rule = await createRule();

    expect(rule).toMatchObject({
      title: 'Buy more, save more',
      type: 'COLLECTION_QUANTITY_TIERS',
      config: validInput.config,
      status: 'active',
      sync: { status: 'SYNCED', error: null, shopifyDiscountId: expect.any(String) as string },
    });
    expect(shopify.discounts.get(rule.sync.shopifyDiscountId!)).toMatchObject({
      title: 'Buy more, save more',
      config: validInput.config,
    });
  });

  it('rejects an invalid rule with errors keyed by field, and saves nothing', async () => {
    const res = await api
      .post('/api/rules', {
        ...validInput,
        title: ' ',
        config: { ...validInput.config, tiers: [{ minQuantity: 2, percentage: 150 }] },
      })
      .expect(422);

    expect(res.body).toMatchObject({
      error: {
        code: 'validation_error',
        details: {
          fields: {
            title: 'Enter a title.',
            'config.tiers.0.percentage': 'Must be 100% or less.',
          },
        },
      },
    });
    expect(await prisma.rule.count({ where: { shop } })).toBe(0);
  });

  it('keeps the rule but marks it out of sync when Shopify rejects it', async () => {
    shopify.failWith(
      new ShopifyUserError('discountAutomaticAppCreate', [
        { message: 'You have reached the maximum number of app discounts.' },
      ]),
    );

    const rule = await createRule();

    expect(rule.sync).toEqual({
      status: 'OUT_OF_SYNC',
      error: 'Shopify rejected the change: You have reached the maximum number of app discounts.',
      shopifyDiscountId: null,
      lastSyncedAt: null,
    });
  });

  it('gives a generic reason when Shopify cannot be reached', async () => {
    shopify.failWith(new Error('socket hang up'));

    const rule = await createRule();

    expect(rule.sync.status).toBe('OUT_OF_SYNC');
    expect(rule.sync.error).toBe(
      'Shopify could not be reached or returned an unexpected error. Try syncing again.',
    );
  });

  it('keeps the new discount ID when a later step fails, so a retry does not duplicate it', async () => {
    shopify.failWith(new Error('timeout'), { afterCreate: true });
    const rule = await createRule();
    expect(rule.sync).toMatchObject({
      status: 'OUT_OF_SYNC',
      shopifyDiscountId: expect.any(String) as string,
    });

    shopify.recover();
    const res = await api.post(`/api/rules/${rule.id}/sync`).expect(200);

    expect((res.body as { rule: RuleDto }).rule.sync.status).toBe('SYNCED');
    expect(shopify.discounts.size).toBe(1);
  });
});

describe('POST /api/rules/:id/sync', () => {
  it('pushes an out-of-sync rule again', async () => {
    shopify.failWith(new Error('socket hang up'));
    const rule = await createRule();

    shopify.recover();
    const res = await api.post(`/api/rules/${rule.id}/sync`).expect(200);

    expect((res.body as { rule: RuleDto }).rule.sync).toMatchObject({
      status: 'SYNCED',
      error: null,
      shopifyDiscountId: expect.any(String) as string,
      lastSyncedAt: expect.any(String) as string,
    });
  });
});

describe('GET /api/rules', () => {
  it('lists only the current shop’s rules, newest first', async () => {
    const first = await createRule({ ...validInput, title: 'First' });
    const second = await createRule({ ...validInput, title: 'Second' });

    const otherShop = shop;
    shop = `test-${randomUUID()}.myshopify.com`;
    await createRule({ ...validInput, title: 'Another shop’s rule' });
    shop = otherShop;

    const res = await api.get('/api/rules').expect(200);
    const rules = (res.body as { rules: RuleDto[] }).rules;

    expect(rules.map((r) => r.id)).toEqual([second.id, first.id]);
  });

  it('derives each rule’s status from its dates', async () => {
    await createRule({ ...validInput, title: 'Later', startsAt: '2099-01-01T00:00:00.000Z' });
    await createRule({
      ...validInput,
      title: 'Over',
      startsAt: '2020-01-01T00:00:00.000Z',
      endsAt: '2020-02-01T00:00:00.000Z',
    });

    const res = await api.get('/api/rules').expect(200);
    const statuses = Object.fromEntries(
      (res.body as { rules: RuleDto[] }).rules.map((r) => [r.title, r.status]),
    );

    expect(statuses).toEqual({ Later: 'scheduled', Over: 'expired' });
  });
});

describe('another shop’s rule', () => {
  it('cannot be read, changed or deleted', async () => {
    const rule = await createRule();
    shop = `test-${randomUUID()}.myshopify.com`;

    await api.get(`/api/rules/${rule.id}`).expect(404);
    await api.put(`/api/rules/${rule.id}`, validInput).expect(404);
    await api.patch(`/api/rules/${rule.id}/active`, { active: false }).expect(404);
    await api.post(`/api/rules/${rule.id}/sync`).expect(404);
    await api.delete(`/api/rules/${rule.id}`).expect(404);

    expect(await prisma.rule.count({ where: { id: rule.id } })).toBe(1);
  });
});

describe('PUT /api/rules/:id', () => {
  it('saves the changes and pushes them to the same discount', async () => {
    const rule = await createRule();

    const res = await api
      .put(`/api/rules/${rule.id}`, {
        ...validInput,
        title: 'Renamed',
        endsAt: '2027-01-01T00:00:00.000Z',
      })
      .expect(200);
    const updated = (res.body as { rule: RuleDto }).rule;

    expect(updated).toMatchObject({ title: 'Renamed', endsAt: '2027-01-01T00:00:00.000Z' });
    expect(updated.sync.shopifyDiscountId).toBe(rule.sync.shopifyDiscountId);
    expect(shopify.discounts.get(rule.sync.shopifyDiscountId!)?.title).toBe('Renamed');
  });

  it('refuses to change the rule type', async () => {
    const rule = await createRule();

    const res = await api
      .put(`/api/rules/${rule.id}`, {
        ...validInput,
        config: { version: 1, type: 'FREE_SHIPPING_THRESHOLD', minSubtotal: 50 },
      })
      .expect(422);

    expect(res.body).toMatchObject({
      error: { details: { fields: { 'config.type': expect.any(String) as string } } },
    });
  });
});

describe('PATCH /api/rules/:id/active', () => {
  it('switches the rule and its discount off and on', async () => {
    const rule = await createRule();
    const discountId = rule.sync.shopifyDiscountId!;

    const off = await api.patch(`/api/rules/${rule.id}/active`, { active: false }).expect(200);
    expect((off.body as { rule: RuleDto }).rule.status).toBe('inactive');
    expect(shopify.discounts.get(discountId)?.active).toBe(false);

    const on = await api.patch(`/api/rules/${rule.id}/active`, { active: true }).expect(200);
    expect((on.body as { rule: RuleDto }).rule.status).toBe('active');
    expect(shopify.discounts.get(discountId)?.active).toBe(true);
  });

  it('needs a boolean', async () => {
    const rule = await createRule();

    await api.patch(`/api/rules/${rule.id}/active`, { active: 'yes' }).expect(422);
  });
});

describe('DELETE /api/rules/:id', () => {
  it('deletes the Shopify discount and the rule', async () => {
    const rule = await createRule();

    await api.delete(`/api/rules/${rule.id}`).expect(204);

    expect(shopify.discounts.size).toBe(0);
    await api.get(`/api/rules/${rule.id}`).expect(404);
  });

  it('keeps the rule, marked out of sync, when Shopify refuses to delete the discount', async () => {
    const rule = await createRule();
    shopify.failWith(
      new ShopifyUserError('discountAutomaticDelete', [{ message: 'Try again later.' }]),
    );

    const res = await api.delete(`/api/rules/${rule.id}`).expect(502);

    expect(res.body).toMatchObject({ error: { code: 'shopify_sync_error' } });
    const kept = (await api.get(`/api/rules/${rule.id}`).expect(200)).body as { rule: RuleDto };
    expect(kept.rule.sync).toMatchObject({
      status: 'OUT_OF_SYNC',
      error: 'Could not delete from Shopify: Shopify rejected the change: Try again later.',
    });
  });

  it('deletes a rule that never reached Shopify without calling Shopify', async () => {
    shopify.failWith(new Error('socket hang up'));
    const rule = await createRule();

    // Shopify is still failing, but there is no discount to delete.
    await api.delete(`/api/rules/${rule.id}`).expect(204);
  });
});
