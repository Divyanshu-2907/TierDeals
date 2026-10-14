import type { RuleDto } from '@tierdeals/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { describe, expect, it, vi } from 'vitest';

import { RulesListPage } from '../src/pages/RulesListPage';

function rule(overrides: Partial<RuleDto> = {}): RuleDto {
  return {
    id: 'rule_1',
    title: 'Buy more, save more',
    type: 'COLLECTION_QUANTITY_TIERS',
    config: {
      version: 1,
      type: 'COLLECTION_QUANTITY_TIERS',
      collectionIds: ['gid://shopify/Collection/1'],
      tiers: [{ minQuantity: 2, percentage: 10 }],
    },
    active: true,
    startsAt: '2026-10-01T00:00:00.000Z',
    endsAt: null,
    combinesWith: { productDiscounts: false, orderDiscounts: false, shippingDiscounts: false },
    status: 'active',
    sync: {
      status: 'SYNCED',
      error: null,
      shopifyDiscountId: 'gid://shopify/DiscountAutomaticNode/1',
      lastSyncedAt: '2026-10-01T00:00:00.000Z',
    },
    createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-10-01T00:00:00.000Z',
    ...overrides,
  };
}

/** A fake API: GET /api/rules returns `rules`; other calls echo a rule back. */
function stubApi(rules: RuleDto[]) {
  const fetchMock = vi.fn((url: string, init?: RequestInit) => {
    if (init?.method === 'PATCH') {
      const { active } = JSON.parse(init.body as string) as { active: boolean };
      return Promise.resolve(
        Response.json({ rule: rule({ active, status: active ? 'active' : 'inactive' }) }),
      );
    }
    if (url === '/api/rules') return Promise.resolve(Response.json({ rules }));
    return Promise.resolve(Response.json({ rule: rules[0] }));
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <RulesListPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('RulesListPage', () => {
  it('lists rules with their status and sync state', async () => {
    stubApi([rule(), rule({ id: 'rule_2', title: 'Free shipping', status: 'scheduled' })]);

    renderPage();

    expect(await screen.findByText('Buy more, save more')).toBeTruthy();
    expect(screen.getByText('Free shipping')).toBeTruthy();
    expect(screen.getByText('Scheduled')).toBeTruthy();
    expect(screen.getAllByText('In sync')).toHaveLength(2);
  });

  it('flags out-of-sync rules with the reason and a retry', async () => {
    stubApi([
      rule({
        sync: {
          status: 'OUT_OF_SYNC',
          error:
            'Shopify rejected the change: You have reached the maximum number of app discounts.',
          shopifyDiscountId: null,
          lastSyncedAt: null,
        },
      }),
    ]);

    renderPage();

    expect(await screen.findByText('Out of sync')).toBeTruthy();
    expect(screen.getByText(/maximum number of app discounts/)).toBeTruthy();
    expect(screen.getByText('Retry sync')).toBeTruthy();
    expect(document.querySelector('s-banner')?.getAttribute('heading')).toBe(
      '1 rule does not match its Shopify discount',
    );
  });

  it('switches a rule off through the API', async () => {
    const fetchMock = stubApi([rule()]);
    renderPage();
    await screen.findByText('Buy more, save more');

    const toggle = document.querySelector('s-switch')!;
    Object.defineProperty(toggle, 'checked', { value: false });
    toggle.dispatchEvent(new Event('change', { bubbles: true }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/rules/rule_1/active',
        expect.objectContaining({ method: 'PATCH', body: '{"active":false}' }),
      ),
    );
    await waitFor(() => expect(shopify.toast.show).toHaveBeenCalledWith('Rule switched off'));
  });

  it('invites the merchant to create a first rule when there are none', async () => {
    stubApi([]);

    renderPage();

    await waitFor(() =>
      expect(document.querySelector('s-empty-state')?.getAttribute('heading')).toBe(
        'Create your first discount rule',
      ),
    );
  });
});
