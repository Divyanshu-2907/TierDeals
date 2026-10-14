/**
 * Application error taxonomy.
 *
 * Handlers throw these; the error middleware (src/middleware/error-handler.ts)
 * is the single place that turns them into an HTTP response. Anything that is
 * *not* an AppError is treated as a bug and reported as a 500 with its details
 * kept out of the response body.
 */
export class AppError extends Error {
  readonly statusCode: number;
  /** Stable machine-readable code the frontend can branch on. */
  readonly code: string;
  /** Safe to show to the merchant? Internal errors are deliberately vague. */
  readonly expose: boolean;
  /** Structured extras merged into the JSON response, e.g. Zod field errors. */
  readonly details: unknown;

  constructor(
    message: string,
    options: {
      statusCode?: number;
      code?: string;
      expose?: boolean;
      details?: unknown;
      cause?: unknown;
    } = {},
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = new.target.name;
    this.statusCode = options.statusCode ?? 500;
    this.code = options.code ?? 'internal_error';
    this.expose = options.expose ?? this.statusCode < 500;
    this.details = options.details;
  }
}

export class ValidationError extends AppError {
  constructor(message = 'The submitted data is invalid.', details?: unknown) {
    super(message, { statusCode: 422, code: 'validation_error', details });
  }
}

export class NotFoundError extends AppError {
  constructor(message = 'Resource not found.') {
    super(message, { statusCode: 404, code: 'not_found' });
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = 'Not authenticated.') {
    super(message, { statusCode: 401, code: 'unauthorized' });
  }
}

/**
 * The local write succeeded but Shopify rejected the matching change, so the
 * two systems have diverged. Carries the rule id so the UI can deep-link to
 * the out-of-sync rule and offer a retry.
 */
export class ShopifySyncError extends AppError {
  constructor(
    message: string,
    readonly ruleId: string | null,
    cause?: unknown,
  ) {
    super(message, { statusCode: 502, code: 'shopify_sync_error', expose: true, cause });
  }
}

export function isAppError(error: unknown): error is AppError {
  return error instanceof AppError;
}
