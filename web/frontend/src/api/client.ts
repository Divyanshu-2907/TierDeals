import type { ApiErrorBody } from '@tierdeals/shared';

/**
 * An error response from the backend. `fields` maps dotted input paths
 * (e.g. `config.tiers.1.percentage`) to messages for inline display.
 */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly fields: Record<string, string> = {},
    readonly requestId?: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/**
 * Set by the backend on a 401 when a new session token would fix it (the
 * old one expired). Any other 401 means re-authentication is needed.
 */
const RETRY_HEADER = 'X-Shopify-Retry-Invalid-Session-Request';

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
}

/**
 * Calls the TierDeals API with a fresh App Bridge session token, which the
 * backend verifies (and, the first time, exchanges for an access token).
 */
export async function apiFetch<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const send = async () =>
    fetch(path, {
      method: options.method ?? 'GET',
      headers: {
        Authorization: `Bearer ${await shopify.idToken()}`,
        ...(options.body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      body: options.body === undefined ? null : JSON.stringify(options.body),
    });

  let response = await send();
  if (response.status === 401 && response.headers.get(RETRY_HEADER) === '1') {
    response = await send();
  }

  if (response.status === 204) {
    // Only DELETE returns 204, and its callers ask for `void`.
    return undefined as T;
  }

  const body: unknown = await response.json().catch(() => undefined);
  if (!response.ok) {
    throw toApiError(response.status, body);
  }
  return body as T;
}

function isErrorBody(body: unknown): body is ApiErrorBody {
  return (
    typeof body === 'object' &&
    body !== null &&
    'error' in body &&
    typeof (body as ApiErrorBody).error?.message === 'string'
  );
}

function toApiError(status: number, body: unknown): ApiError {
  if (!isErrorBody(body)) {
    return new ApiError(status, 'unknown_error', `The request failed (HTTP ${status}).`);
  }

  const { code, message, details, requestId } = body.error;
  const fields =
    typeof details === 'object' && details !== null && 'fields' in details
      ? ((details as { fields: Record<string, string> }).fields ?? {})
      : {};
  return new ApiError(status, code, message, fields, requestId);
}
