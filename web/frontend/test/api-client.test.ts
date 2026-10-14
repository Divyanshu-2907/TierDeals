import { describe, expect, it, vi } from 'vitest';

import { ApiError, apiFetch } from '../src/api/client';

function jsonResponse(status: number, body: unknown, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
}

describe('apiFetch', () => {
  it('sends a fresh session token and JSON body', async () => {
    const fetchMock = vi.fn(() => Promise.resolve(jsonResponse(200, { ok: true })));
    vi.stubGlobal('fetch', fetchMock);

    await expect(apiFetch('/api/rules', { method: 'POST', body: { title: 'x' } })).resolves.toEqual(
      {
        ok: true,
      },
    );

    expect(fetchMock).toHaveBeenCalledWith('/api/rules', {
      method: 'POST',
      headers: { Authorization: 'Bearer session-token', 'Content-Type': 'application/json' },
      body: '{"title":"x"}',
    });
  });

  it('retries once with a new token when the backend asks for it', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response('expired', {
          status: 401,
          headers: { 'X-Shopify-Retry-Invalid-Session-Request': '1' },
        }),
      )
      .mockResolvedValueOnce(jsonResponse(200, { rules: [] }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(apiFetch('/api/rules')).resolves.toEqual({ rules: [] });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(shopify.idToken).toHaveBeenCalledTimes(2);
  });

  it('does not retry a 401 the backend did not mark as retryable', async () => {
    const fetchMock = vi.fn(() => Promise.resolve(new Response('no', { status: 401 })));
    vi.stubGlobal('fetch', fetchMock);

    await expect(apiFetch('/api/rules')).rejects.toBeInstanceOf(ApiError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('turns an error response into an ApiError with field errors', async () => {
    vi.stubGlobal('fetch', () =>
      Promise.resolve(
        jsonResponse(422, {
          error: {
            code: 'validation_error',
            message: 'The rule has errors.',
            requestId: 'req-1',
            details: { fields: { title: 'Enter a title.' } },
          },
        }),
      ),
    );

    const error = await apiFetch('/api/rules', { method: 'POST', body: {} }).catch(
      (e: unknown) => e,
    );

    expect(error).toMatchObject({
      status: 422,
      code: 'validation_error',
      message: 'The rule has errors.',
      fields: { title: 'Enter a title.' },
      requestId: 'req-1',
    });
  });

  it('returns nothing for 204 No Content', async () => {
    vi.stubGlobal('fetch', () => Promise.resolve(new Response(null, { status: 204 })));

    await expect(apiFetch<void>('/api/rules/1', { method: 'DELETE' })).resolves.toBeUndefined();
  });
});
