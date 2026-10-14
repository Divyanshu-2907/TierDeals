import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { RuleFormPage } from '../src/pages/RuleFormPage';

function renderNewRuleForm() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/rules/new']}>
        <Routes>
          <Route path="/rules/new" element={<RuleFormPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

/**
 * Picks a type the way the Polaris select does: it updates its `value`
 * property, then fires a native change event.
 */
function chooseType(value: string) {
  const select = document.querySelector('s-select[label="Type"]')!;
  // Writable, like the real element's, because React assigns the controlled
  // value back on the next render.
  Object.defineProperty(select, 'value', { value, configurable: true, writable: true });
  select.dispatchEvent(new Event('change', { bubbles: true }));
}

const sectionHeadings = () =>
  [...document.querySelectorAll('s-section')].map((s) => s.getAttribute('heading'));

const fieldLabels = () =>
  [...document.querySelectorAll('s-number-field, s-money-field')].map((f) =>
    f.getAttribute('label'),
  );

beforeEach(() => {
  // A new rule needs nothing from the API until it is saved.
  vi.stubGlobal(
    'fetch',
    vi.fn(() => Promise.reject(new Error('The new-rule form should not call the API'))),
  );
});

describe('RuleFormPage, creating a rule', () => {
  it('starts with the collection quantity tier fields', () => {
    renderNewRuleForm();

    expect(sectionHeadings()).toEqual([
      'Rule',
      'Collections',
      'Quantity tiers',
      'Active dates',
      'Combinations',
      'Status',
    ]);
    expect(fieldLabels()).toEqual(['Minimum items', 'Discount']);
  });

  it('shows each type’s own fields when the Type select changes', async () => {
    renderNewRuleForm();

    chooseType('CART_SUBTOTAL_TIERS');
    await waitFor(() =>
      expect(sectionHeadings()).toEqual([
        'Rule',
        'Subtotal tiers',
        'Active dates',
        'Combinations',
        'Status',
      ]),
    );
    expect(fieldLabels()).toEqual(['Minimum subtotal', 'Discount']);

    chooseType('FREE_SHIPPING_THRESHOLD');
    await waitFor(() =>
      expect(sectionHeadings()).toEqual([
        'Rule',
        'Threshold',
        'Active dates',
        'Combinations',
        'Status',
      ]),
    );
    expect(fieldLabels()).toEqual(['Minimum subtotal']);

    chooseType('COLLECTION_QUANTITY_TIERS');
    await waitFor(() => expect(sectionHeadings()).toContain('Quantity tiers'));
    expect(sectionHeadings()).toContain('Collections');
    expect(fieldLabels()).toEqual(['Minimum items', 'Discount']);
  });

  it('keeps the chosen type when changes arrive before React re-renders', async () => {
    // With an update already pending, React runs the next state updater
    // later, during render, when the change event (and its currentTarget) is
    // long gone. This is how the admin hit the bug: the handler read the value
    // inside the updater, got '' and dropped every type-specific section.
    renderNewRuleForm();

    chooseType('CART_SUBTOTAL_TIERS');
    chooseType('FREE_SHIPPING_THRESHOLD');

    await waitFor(() => expect(sectionHeadings()).toContain('Threshold'));
  });

  it('ignores a value that is not a rule type', async () => {
    renderNewRuleForm();

    chooseType('');
    // Give React a chance to (wrongly) re-render.
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(sectionHeadings()).toContain('Quantity tiers');
  });
});
