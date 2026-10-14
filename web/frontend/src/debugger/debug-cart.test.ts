import type { DebugResult } from '@tierdeals/shared';
import { describe, expect, it } from 'vitest';

import { buildBugReport, newLine, parsePastedCart, validateCart } from './debug-cart';

const LIQUID = 'gid://shopify/Product/10';
const HYDROGEN = 'gid://shopify/Collection/1';

describe('validateCart', () => {
  it('turns the form into the API’s cart', () => {
    const result = validateCart({
      presentmentCurrencyRate: '1',
      lines: [newLine({ productId: LIQUID, title: 'Liquid', quantity: '2', unitPrice: '749.95' })],
    });

    expect(result).toEqual({
      ok: true,
      cart: {
        presentmentCurrencyRate: 1,
        lines: [{ productId: LIQUID, title: 'Liquid', quantity: 2, unitPrice: 749.95 }],
      },
    });
  });

  it('reports bad fields by line', () => {
    const result = validateCart({
      presentmentCurrencyRate: '0',
      lines: [newLine({ productId: LIQUID, title: 'Liquid', quantity: '', unitPrice: '-1' })],
    });

    expect(result).toEqual({
      ok: false,
      errors: {
        presentmentCurrencyRate: 'Must be more than 0.',
        'lines.0.quantity': 'Enter a quantity.',
        'lines.0.unitPrice': 'Must not be negative.',
      },
    });
  });
});

describe('parsePastedCart', () => {
  const cart = {
    presentmentCurrencyRate: 1,
    lines: [
      {
        productId: LIQUID,
        title: 'Liquid',
        quantity: 3,
        unitPrice: 100,
        collectionIds: [HYDROGEN],
      },
    ],
  };

  it('loads a bare cart, keeping the collections it lists', () => {
    const result = parsePastedCart(JSON.stringify(cart));

    expect(result.ok && result.values.lines).toEqual([
      expect.objectContaining({
        productId: LIQUID,
        quantity: '3',
        unitPrice: '100',
        collectionIds: [HYDROGEN],
      }),
    ]);
  });

  it('loads the cart out of a whole bug report', () => {
    const result = parsePastedCart(
      JSON.stringify({ kind: 'tierdeals-bug-report', version: 1, cart }),
    );

    expect(result.ok && result.values.lines).toHaveLength(1);
  });

  it('explains what is wrong with bad input', () => {
    expect(parsePastedCart('{ nope')).toEqual({ ok: false, error: 'That is not valid JSON.' });
    expect(
      parsePastedCart(JSON.stringify({ lines: [{ productId: 'x', quantity: 1, unitPrice: 1 }] })),
    ).toEqual({ ok: false, error: 'lines.0.productId: Must be a product ID.' });
  });
});

describe('buildBugReport', () => {
  it('produces a report whose cart can be pasted back in unchanged', () => {
    const result: DebugResult = {
      evaluatedAt: '2026-10-14T12:00:00.000Z',
      shop: 'tierdeals-dev.myshopify.com',
      currencyCode: 'INR',
      cart: {
        subtotal: 300,
        presentmentCurrencyRate: 1,
        lines: [
          {
            productId: LIQUID,
            title: 'Liquid',
            quantity: 3,
            unitPrice: 100,
            lineTotal: 300,
            collections: [{ id: HYDROGEN, title: 'Hydrogen' }],
          },
        ],
      },
      results: [],
      notes: [],
    };

    const report = buildBugReport(result, [], new Date('2026-10-14T12:05:00Z'));

    expect(report).toMatchObject({
      kind: 'tierdeals-bug-report',
      version: 1,
      generatedAt: '2026-10-14T12:05:00.000Z',
      cart: {
        lines: [{ productId: LIQUID, quantity: 3, unitPrice: 100, collectionIds: [HYDROGEN] }],
      },
    });

    const roundTrip = parsePastedCart(JSON.stringify(report));
    expect(roundTrip.ok && validateCart(roundTrip.values)).toEqual({ ok: true, cart: report.cart });
  });
});
