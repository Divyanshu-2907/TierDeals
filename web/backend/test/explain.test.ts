import type { DebugLine, RuleConfig, RuleDto } from '@tierdeals/shared';
import { describe, expect, it } from 'vitest';

import { explainRule, explainRules, type ExplainContext } from '../src/debugger/explain.js';

const HYDROGEN = 'gid://shopify/Collection/1';
const OXYGEN = 'gid://shopify/Collection/2';
const now = new Date('2026-10-14T12:00:00Z');

function rule(config: RuleConfig, overrides: Partial<RuleDto> = {}): RuleDto {
  return {
    id: 'rule_1',
    title: 'Test rule',
    type: config.type,
    config,
    active: true,
    startsAt: '2026-10-01T00:00:00.000Z',
    endsAt: null,
    combinesWith: { productDiscounts: false, orderDiscounts: false, shippingDiscounts: false },
    status: 'active',
    sync: { status: 'SYNCED', error: null, shopifyDiscountId: 'gid://x', lastSyncedAt: null },
    createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-10-01T00:00:00.000Z',
    ...overrides,
  };
}

const collectionRule = (tiers: [number, number][], collectionIds = [HYDROGEN]) =>
  rule({
    version: 1,
    type: 'COLLECTION_QUANTITY_TIERS',
    collectionIds,
    tiers: tiers.map(([minQuantity, percentage]) => ({ minQuantity, percentage })),
  });

const subtotalRule = (tiers: [number, number][]) =>
  rule({
    version: 1,
    type: 'CART_SUBTOTAL_TIERS',
    tiers: tiers.map(([minSubtotal, percentage]) => ({ minSubtotal, percentage })),
  });

const shippingRule = (minSubtotal: number) =>
  rule({ version: 1, type: 'FREE_SHIPPING_THRESHOLD', minSubtotal });

function line(
  title: string,
  quantity: number,
  unitPrice: number,
  collections: string[],
): DebugLine {
  return {
    productId: `gid://shopify/Product/${title.length}`,
    title,
    quantity,
    unitPrice,
    lineTotal: quantity * unitPrice,
    collections: collections.map((id) => ({ id, title: null })),
  };
}

function context(lines: DebugLine[], overrides: Partial<ExplainContext> = {}): ExplainContext {
  return {
    lines,
    presentmentCurrencyRate: 1,
    currencyCode: 'INR',
    collectionTitles: new Map([
      [HYDROGEN, 'Hydrogen'],
      [OXYGEN, 'Oxygen'],
    ]),
    now,
    ...overrides,
  };
}

describe('explainRule: collection quantity tiers', () => {
  const tiers: [number, number][] = [
    [2, 10],
    [3, 15],
  ];

  it('explains a shortfall in the merchant’s terms', () => {
    const result = explainRule(
      collectionRule([[3, 15]]),
      context([line('Liquid', 2, 600, [HYDROGEN]), line('Minimal', 5, 100, [])]),
    );

    expect(result).toMatchObject({
      outcome: 'not_applied',
      reason: 'Not applied: 2 items from Hydrogen, needs 3.',
      amount: null,
      discountedLines: [],
    });
  });

  it('says "no items" when nothing in the cart is from the collections', () => {
    const result = explainRule(collectionRule(tiers), context([line('Minimal', 4, 100, [])]));

    expect(result.reason).toBe('Not applied: no items from Hydrogen, needs 2.');
  });

  it('explains the tier reached, the amount off, and what the next tier needs', () => {
    const result = explainRule(
      collectionRule(tiers),
      context([
        line('Oxygen', 1, 1025, [HYDROGEN]),
        line('Liquid', 1, 749.95, [HYDROGEN]),
        line('Complete', 1, 699.95, [OXYGEN]),
      ]),
    );

    expect(result).toMatchObject({
      outcome: 'applied',
      reason:
        'Applied: 2 items from Hydrogen reach the 2+ tier, so 10% comes off those items. 1 more item would reach 15%.',
      amount: 177.5,
      discountedLines: [0, 1],
    });
  });

  it('does not hint at a next tier from the top tier', () => {
    const result = explainRule(
      collectionRule(tiers),
      context([line('Liquid', 5, 100, [HYDROGEN])]),
    );

    expect(result.reason).toBe(
      'Applied: 5 items from Hydrogen reach the 3+ tier, so 15% comes off those items.',
    );
  });

  it('names several collections and flags deleted ones', () => {
    const result = explainRule(
      collectionRule([[2, 10]], [HYDROGEN, OXYGEN, 'gid://shopify/Collection/99']),
      context([]),
    );

    expect(result.reason).toBe(
      'Not applied: no items from Hydrogen, Oxygen or a deleted collection, needs 2.',
    );
  });
});

describe('explainRule: cart subtotal tiers', () => {
  const rule = subtotalRule([
    [1000, 5],
    [2000, 10],
  ]);

  it('formats amounts in the shop currency', () => {
    const result = explainRule(rule, context([line('Liquid', 1, 950, [])]));

    expect(result.reason).toBe('Not applied: the subtotal is ₹950.00, needs ₹1,000.00.');
  });

  it('reproduces the dev-store order: 10% off a ₹3,074.90 cart is ₹307.49', () => {
    const result = explainRule(
      rule,
      context([
        line('Oxygen', 1, 1025, [HYDROGEN]),
        line('Liquid', 1, 749.95, [HYDROGEN]),
        line('Hydrogen', 1, 600, [HYDROGEN]),
        line('Complete', 1, 699.95, []),
      ]),
    );

    expect(result).toMatchObject({
      outcome: 'applied',
      reason:
        'Applied: the subtotal of ₹3,074.90 reaches the ₹2,000.00 tier, so 10% comes off the order.',
      amount: 307.49,
    });
  });

  it('suggests how much more to spend for the next tier', () => {
    const result = explainRule(rule, context([line('Liquid', 1, 1500, [])]));

    expect(result.reason).toBe(
      'Applied: the subtotal of ₹1,500.00 reaches the ₹1,000.00 tier, so 5% comes off the order. Spending ₹500.00 more would reach 10%.',
    );
  });

  it('converts a foreign-currency cart into the shop currency first', () => {
    // 1,500 in the buyer's currency at a rate of 1.5 is ₹1,000.00.
    const result = explainRule(
      rule,
      context([line('Liquid', 1, 1500, [])], { presentmentCurrencyRate: 1.5 }),
    );

    expect(result).toMatchObject({ outcome: 'applied', amount: 50 });
    expect(result.reason).toContain('the subtotal of ₹1,000.00 reaches the ₹1,000.00 tier');
  });
});

describe('explainRule: free shipping threshold', () => {
  it('explains both sides of the threshold, without guessing an amount', () => {
    expect(explainRule(shippingRule(1000), context([line('Liquid', 1, 999.99, [])]))).toMatchObject(
      {
        outcome: 'not_applied',
        reason: 'Not applied: the subtotal is ₹999.99, needs ₹1,000.00 for free shipping.',
      },
    );
    expect(explainRule(shippingRule(1000), context([line('Liquid', 1, 1000, [])]))).toMatchObject({
      outcome: 'applied',
      reason: 'Applied: the subtotal of ₹1,000.00 is at least ₹1,000.00, so shipping is free.',
      amount: null,
    });
  });
});

describe('explainRule: rules that are not evaluated', () => {
  const cart = context([line('Liquid', 9, 100, [HYDROGEN])]);

  it.each([
    [{ active: false }, 'Skipped: the rule is switched off.'],
    [{ startsAt: '2026-11-01T00:00:00.000Z' }, 'Skipped: the rule starts on Nov 1, 2026.'],
    [{ endsAt: '2026-10-10T00:00:00.000Z' }, 'Skipped: the rule ended on Oct 10, 2026.'],
  ])('skips a rule with %o', (overrides, reason) => {
    const base = collectionRule([[2, 10]]);
    const result = explainRule({ ...base, ...overrides }, cart);

    expect(result).toMatchObject({ outcome: 'skipped', reason, decision: null });
  });

  it('reports a stored config the Function would reject', () => {
    const broken = rule({
      version: 1,
      type: 'FREE_SHIPPING_THRESHOLD',
      minSubtotal: -5,
    });

    expect(explainRule(broken, cart)).toMatchObject({
      outcome: 'not_applied',
      reason:
        'Not applied: the saved configuration is invalid ("minSubtotal" must not be negative). Edit and save the rule to fix it.',
    });
  });

  it('warns when Shopify may have an older version of the rule', () => {
    const outOfSync = collectionRule([[2, 10]]);
    outOfSync.sync = {
      status: 'OUT_OF_SYNC',
      error: 'x',
      shopifyDiscountId: null,
      lastSyncedAt: null,
    };

    expect(explainRule(outOfSync, cart).warning).toMatch(/older version of this rule/);
  });
});

describe('explainRules: notes across rules', () => {
  const cart = context([line('Liquid', 3, 1000, [HYDROGEN])]);

  it('notes two applied discounts that do not combine', () => {
    const product = { ...collectionRule([[2, 10]]), id: 'a', title: 'Snowboard bundle' };
    const order = { ...subtotalRule([[1000, 5]]), id: 'b', title: 'Spend and save' };

    const { notes } = explainRules([product, order], cart);

    expect(notes).toEqual([
      '“Snowboard bundle” and “Spend and save” both apply, but they are not both set to combine with each other, so Shopify applies only one of them: whichever saves the customer more.',
    ]);
  });

  it('has no note when both are set to combine with each other', () => {
    const product = {
      ...collectionRule([[2, 10]]),
      id: 'a',
      combinesWith: { productDiscounts: false, orderDiscounts: true, shippingDiscounts: false },
    };
    const order = {
      ...subtotalRule([[1000, 5]]),
      id: 'b',
      combinesWith: { productDiscounts: true, orderDiscounts: false, shippingDiscounts: false },
    };

    expect(explainRules([product, order], cart).notes).toEqual([]);
  });

  it('only considers rules that apply', () => {
    const product = { ...collectionRule([[2, 10]]), id: 'a' };
    const order = { ...subtotalRule([[99_999, 5]]), id: 'b' };

    expect(explainRules([product, order], cart).notes).toEqual([]);
  });
});
