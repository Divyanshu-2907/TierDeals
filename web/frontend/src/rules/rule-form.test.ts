import type { RuleDto } from '@tierdeals/shared';
import { describe, expect, it } from 'vitest';

import {
  emptyForm,
  formFromRule,
  newTierRow,
  validateForm,
  withType,
  type RuleFormValues,
} from './rule-form';

const today = new Date(2026, 9, 14); // 14 Oct 2026, local time

function collectionForm(overrides: Partial<RuleFormValues> = {}): RuleFormValues {
  return {
    ...emptyForm('COLLECTION_QUANTITY_TIERS', today),
    title: 'Buy more, save more',
    collections: [{ id: 'gid://shopify/Collection/1', title: 'Hydrogen' }],
    tiers: [newTierRow('2', '10'), newTierRow('3', '15')],
    ...overrides,
  };
}

describe('validateForm', () => {
  it('turns a valid form into an API payload', () => {
    const result = validateForm(collectionForm({ endDate: '2026-10-31' }));

    expect(result).toEqual({
      ok: true,
      input: {
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
        startsAt: new Date(2026, 9, 14, 0, 0, 0).toISOString(),
        endsAt: new Date(2026, 9, 31, 23, 59, 59, 999).toISOString(),
        combinesWith: { productDiscounts: false, orderDiscounts: false, shippingDiscounts: false },
      },
    });
  });

  it('reports blank and invalid fields under the schema’s paths', () => {
    const result = validateForm(
      collectionForm({
        title: '',
        collections: [],
        tiers: [newTierRow('', '10'), newTierRow('3', 'abc')],
      }),
    );

    expect(result).toEqual({
      ok: false,
      errors: {
        title: 'Enter a title.',
        'config.collectionIds': 'Choose at least one collection.',
        'config.tiers.0.minQuantity': 'Enter a quantity.',
        'config.tiers.1.percentage': 'Enter a percentage.',
      },
    });
  });

  it('checks the tiers against each other', () => {
    const result = validateForm(
      collectionForm({ tiers: [newTierRow('2', '15'), newTierRow('3', '10')] }),
    );

    expect(result).toEqual({
      ok: false,
      errors: {
        'config.tiers.1.percentage':
          'A higher tier must give a bigger discount than the tier below it.',
      },
    });
  });

  it('needs the end date after the start date', () => {
    const result = validateForm(collectionForm({ startDate: '2026-10-14', endDate: '2026-10-13' }));

    expect(result).toEqual({
      ok: false,
      errors: { endsAt: 'The end date must be after the start date.' },
    });
  });

  it('allows a rule that starts and ends on the same day', () => {
    expect(validateForm(collectionForm({ endDate: '2026-10-14' })).ok).toBe(true);
  });

  it('builds a free shipping rule', () => {
    const result = validateForm({
      ...emptyForm('FREE_SHIPPING_THRESHOLD', today),
      title: 'Free shipping over 75',
      minSubtotal: '75',
    });

    expect(result.ok && result.input.config).toEqual({
      version: 1,
      type: 'FREE_SHIPPING_THRESHOLD',
      minSubtotal: 75,
    });
  });
});

describe('withType', () => {
  it('keeps shared fields and resets the type-specific ones', () => {
    const switched = withType(collectionForm({ title: 'Keep me' }), 'CART_SUBTOTAL_TIERS');

    expect(switched).toMatchObject({
      title: 'Keep me',
      type: 'CART_SUBTOTAL_TIERS',
      collections: [],
    });
    expect(switched.tiers).toHaveLength(1);
    expect(switched.tiers[0]).toMatchObject({ threshold: '', percentage: '' });
  });
});

describe('formFromRule', () => {
  it('round-trips a saved rule through the form unchanged', () => {
    const input = validateForm(collectionForm({ endDate: '2026-12-31' }));
    if (!input.ok) throw new Error('fixture should be valid');

    const rule: RuleDto = {
      ...input.input,
      id: 'rule_1',
      type: 'COLLECTION_QUANTITY_TIERS',
      endsAt: input.input.endsAt,
      status: 'active',
      sync: { status: 'SYNCED', error: null, shopifyDiscountId: null, lastSyncedAt: null },
      createdAt: '2026-10-14T00:00:00.000Z',
      updatedAt: '2026-10-14T00:00:00.000Z',
    };

    const again = validateForm(formFromRule(rule));

    expect(again).toEqual(input);
  });
});
