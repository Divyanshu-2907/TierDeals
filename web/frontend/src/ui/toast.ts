import { ApiError } from '../api/client';

/** Shows an error toast. API errors carry a message meant for the merchant. */
export function showError(error: unknown): void {
  const message =
    typeof error === 'string'
      ? error
      : error instanceof ApiError
        ? error.message
        : 'Something went wrong. Try again.';
  shopify.toast.show(message, { isError: true });
}
