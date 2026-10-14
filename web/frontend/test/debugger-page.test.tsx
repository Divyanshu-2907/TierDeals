import type { DebugResult } from '@tierdeals/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { DebuggerPage } from '../src/pages/DebuggerPage';

const LIQUID = 'gid://shopify/Product/10';
const HYDROGEN = 'gid://shopify/Collection/1';

const result: DebugResult = {
  evaluatedAt: '2026-10-14T12:00:00.000Z',
  shop: 'tierdeals-dev.myshopify.com',
  currencyCode: 'INR',
  cart: {
    subtotal: 1499.9,
    presentmentCurrencyRate: 1,
    lines: [
      {
        productId: LIQUID,
        title: 'Liquid',
        quantity: 2,
        unitPrice: 749.95,
        lineTotal: 1499.9,
        collections: [{ id: HYDROGEN, title: 'Hydrogen' }],
      },
    ],
  },
  results: [
    {
      ruleId: 'rule_1',
      title: 'Snowboard bundle',
      type: 'COLLECTION_QUANTITY_TIERS',
      status: 'active',
      syncStatus: 'SYNCED',
      outcome: 'not_applied',
      reason: 'Not applied: 2 items from Hydrogen, needs 3.',
      decision: { decision: 'not_applied', reason: 'below_threshold', measured: 2 },
      amount: null,
      discountedLines: [],
      warning: null,
    },
  ],
  notes: [],
};

/** Stands in for the API: GET /api/rules and POST /api/debugger/evaluate. */
function stubApi() {
  const fetchMock = vi.fn((url: string) =>
    Promise.resolve(
      url === '/api/rules' ? Response.json({ rules: [] }) : Response.json({ result }),
    ),
  );
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <DebuggerPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

/** Modals are driven through their showOverlay/hideOverlay methods. */
function stubModals() {
  for (const modal of document.querySelectorAll('s-modal')) {
    Object.assign(modal, { showOverlay: vi.fn(), hideOverlay: vi.fn() });
  }
}

const click = (element: Element) =>
  element.dispatchEvent(new MouseEvent('click', { bubbles: true }));

function buttonNamed(name: string): Element {
  const button = [...document.querySelectorAll('s-button')].find((b) => b.textContent === name);
  if (!button) throw new Error(`No button "${name}"`);
  return button;
}

/** Types into the paste box, lets React re-render, then clicks Load cart. */
async function pasteJson(text: string) {
  const area = document.querySelector('s-text-area[label="JSON"]')!;
  Object.defineProperty(area, 'value', { value: text, configurable: true, writable: true });
  area.dispatchEvent(new Event('input', { bubbles: true }));
  await act(() => Promise.resolve());
  click(buttonNamed('Load cart'));
}

beforeEach(() => {
  stubApi();
});

describe('DebuggerPage', () => {
  it('loads a pasted bug report, evaluates it and shows each rule’s reason', async () => {
    renderPage();
    stubModals();

    await pasteJson(
      JSON.stringify({
        kind: 'tierdeals-bug-report',
        version: 1,
        cart: {
          presentmentCurrencyRate: 1,
          lines: [
            {
              productId: LIQUID,
              title: 'Liquid',
              quantity: 2,
              unitPrice: 749.95,
              collectionIds: [HYDROGEN],
            },
          ],
        },
      }),
    );

    await screen.findByText('Collections from pasted JSON');
    expect(
      (document.querySelector('s-modal#paste-cart-modal') as unknown as { hideOverlay: () => void })
        .hideOverlay,
    ).toHaveBeenCalled();

    click(buttonNamed('Evaluate'));

    expect(await screen.findByText('Not applied: 2 items from Hydrogen, needs 3.')).toBeTruthy();
    expect(fetch).toHaveBeenCalledWith(
      '/api/debugger/evaluate',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          cart: {
            presentmentCurrencyRate: 1,
            lines: [
              {
                productId: LIQUID,
                title: 'Liquid',
                quantity: 2,
                unitPrice: 749.95,
                collectionIds: [HYDROGEN],
              },
            ],
          },
        }),
      }),
    );
  });

  it('keeps the paste dialog open and shows the error for invalid JSON', async () => {
    renderPage();
    stubModals();

    await pasteJson('{ not json');

    await waitFor(() =>
      expect(document.querySelector('s-text-area[label="JSON"]')?.getAttribute('error')).toBe(
        'That is not valid JSON.',
      ),
    );
    expect(
      (document.querySelector('s-modal#paste-cart-modal') as unknown as { hideOverlay: () => void })
        .hideOverlay,
    ).not.toHaveBeenCalled();
  });

  it('copies a bug report that reproduces the result', async () => {
    const writeText = vi.fn((_text: string) => Promise.resolve());
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    renderPage();
    stubModals();
    await pasteJson(
      JSON.stringify({
        lines: [{ productId: LIQUID, quantity: 2, unitPrice: 749.95, collectionIds: [HYDROGEN] }],
      }),
    );
    click(buttonNamed('Evaluate'));
    await screen.findByText('Not applied: 2 items from Hydrogen, needs 3.');

    click(buttonNamed('Copy as bug report'));

    await waitFor(() => expect(writeText).toHaveBeenCalledOnce());
    const report = JSON.parse(writeText.mock.calls[0]![0]) as Record<string, unknown>;
    expect(report).toMatchObject({
      kind: 'tierdeals-bug-report',
      shop: 'tierdeals-dev.myshopify.com',
      cart: { lines: [{ productId: LIQUID, quantity: 2, collectionIds: [HYDROGEN] }] },
      result: { results: [{ reason: 'Not applied: 2 items from Hydrogen, needs 3.' }] },
    });
    expect(shopify.toast.show).toHaveBeenCalledWith('Bug report copied');
  });

  it('shows the report to copy by hand when the clipboard is blocked', async () => {
    vi.stubGlobal('navigator', {
      clipboard: { writeText: () => Promise.reject(new Error('blocked')) },
    });
    renderPage();
    stubModals();
    await pasteJson(
      JSON.stringify({
        lines: [{ productId: LIQUID, quantity: 2, unitPrice: 749.95, collectionIds: [HYDROGEN] }],
      }),
    );
    click(buttonNamed('Evaluate'));
    await screen.findByText('Not applied: 2 items from Hydrogen, needs 3.');

    click(buttonNamed('Copy as bug report'));

    const reportModal = document.querySelector('s-modal#bug-report-modal') as unknown as {
      showOverlay: () => void;
    };
    await waitFor(() => expect(reportModal.showOverlay).toHaveBeenCalled());
    expect(
      document.querySelector('s-text-area[label="Bug report JSON"]')?.getAttribute('value'),
    ).toContain('"kind": "tierdeals-bug-report"');
  });

  it('downloads the report as a .json file from the fallback dialog', async () => {
    vi.stubGlobal('navigator', {
      clipboard: { writeText: () => Promise.reject(new Error('blocked')) },
    });
    // jsdom implements neither object URLs nor navigation, so capture both.
    let blob: Blob | undefined;
    URL.createObjectURL = vi.fn((b: Blob) => {
      blob = b;
      return 'blob:report';
    });
    URL.revokeObjectURL = vi.fn();
    const clickSpy = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(function (this: HTMLAnchorElement) {});

    renderPage();
    stubModals();
    await pasteJson(
      JSON.stringify({
        lines: [{ productId: LIQUID, quantity: 2, unitPrice: 749.95, collectionIds: [HYDROGEN] }],
      }),
    );
    click(buttonNamed('Evaluate'));
    await screen.findByText('Not applied: 2 items from Hydrogen, needs 3.');
    click(buttonNamed('Copy as bug report'));
    await waitFor(() =>
      expect(
        document.querySelector('s-text-area[label="Bug report JSON"]')?.getAttribute('value'),
      ).toContain('tierdeals-bug-report'),
    );

    click(buttonNamed('Download as .json'));

    expect(clickSpy).toHaveBeenCalledOnce();
    const link = clickSpy.mock.contexts[0] as HTMLAnchorElement;
    expect(link.download).toBe('tierdeals-bug-report-tierdeals-dev-2026-10-14T12-00-00.json');
    expect(link.href).toBe('blob:report');
    expect(blob?.type).toBe('application/json');
    expect(JSON.parse(await blob!.text())).toMatchObject({ kind: 'tierdeals-bug-report' });
  });
});
