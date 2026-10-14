import { describe, expect, it } from 'vitest';

import { fieldErrors, ruleInputSchema, type RuleInput } from '../src/index.js';

const validInput = {
  title: 'Summer bundle',
  config: { version: 1, type: 'FREE_SHIPPING_THRESHOLD', minSubtotal: 75 },
  active: true,
  startsAt: '2026-10-14T00:00:00Z',
  endsAt: null,
  combinesWith: { productDiscounts: true, orderDiscounts: false, shippingDiscounts: false },
} satisfies RuleInput;

function errorsFor(input: unknown): Record<string, string> {
  const result = ruleInputSchema.safeParse(input);
  return result.success ? {} : fieldErrors(result.error.issues);
}

describe('ruleInputSchema', () => {
  it('accepts a valid rule and trims the title', () => {
    expect(ruleInputSchema.parse({ ...validInput, title: '  Summer bundle  ' })).toEqual(
      validInput,
    );
  });

  it('needs a non-blank title', () => {
    expect(errorsFor({ ...validInput, title: '   ' })).toEqual({ title: 'Enter a title.' });
  });

  it('needs the end date after the start date', () => {
    expect(errorsFor({ ...validInput, endsAt: '2026-10-14T00:00:00Z' })).toEqual({
      endsAt: 'The end date must be after the start date.',
    });
    expect(errorsFor({ ...validInput, endsAt: '2026-10-15T00:00:00+05:30' })).toEqual({});
  });

  it('rejects dates that are not ISO 8601 with an offset', () => {
    expect(errorsFor({ ...validInput, startsAt: '14/10/2026' })).toEqual({
      startsAt: 'Enter a valid start date.',
    });
  });

  it('reports nested config errors under config.*', () => {
    expect(errorsFor({ ...validInput, config: { ...validInput.config, minSubtotal: -5 } })).toEqual(
      { 'config.minSubtotal': 'Must not be negative.' },
    );
  });
});
