import { z } from 'zod';

/**
 * Environment contract for the TierDeals backend.
 *
 * Everything the server needs is declared once, here, and parsed before the
 * HTTP listener opens. A missing or malformed variable fails the boot with a
 * readable message instead of surfacing as `undefined` somewhere deep in a
 * request handler at 3am.
 */
const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),

  PORT: z.coerce.number().int().min(1).max(65_535).default(3000),

  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),

  /** Postgres connection string. Used by Prisma and by the Shopify session store. */
  DATABASE_URL: z
    .string()
    .min(1)
    .refine(
      (value) => value.startsWith('postgres://') || value.startsWith('postgresql://'),
      'must be a postgres:// or postgresql:// connection string',
    ),

  /** Client ID of the app. `shopify app env show` prints it. */
  SHOPIFY_API_KEY: z.string().min(1),

  /** Client secret of the app. Never log this. */
  SHOPIFY_API_SECRET: z.string().min(1),

  /**
   * Public HTTPS origin of this app. Under `shopify app dev` this comes from
   * the CLI's APP_URL instead (see parseEnv), so .env only matters when the
   * server runs without the CLI.
   */
  SHOPIFY_APP_URL: z.url(),

  /** Comma-separated in the environment, a string array everywhere else. */
  SCOPES: z
    .string()
    .min(1)
    .transform((value) =>
      value
        .split(',')
        .map((scope) => scope.trim())
        .filter((scope) => scope.length > 0),
    )
    .pipe(z.array(z.string()).nonempty()),
});

export type Env = z.infer<typeof envSchema> & {
  /** SHOPIFY_APP_URL without the scheme, which is what the Shopify SDK wants. */
  readonly hostName: string;
  readonly isProduction: boolean;
  readonly isTest: boolean;
};

function formatIssues(error: z.ZodError): string {
  return error.issues
    .map((issue) => {
      const path = issue.path.join('.') || '(root)';
      return `  - ${path}: ${issue.message}`;
    })
    .join('\n');
}

/**
 * Parse and validate `source` (defaults to `process.env`).
 *
 * Exported as a pure function so tests can feed it a synthetic environment
 * without mutating the real process.
 */
export function parseEnv(source: NodeJS.ProcessEnv = process.env): Env {
  // `shopify app dev` injects the tunnel or localhost URL as APP_URL (and
  // HOST), not SHOPIFY_APP_URL. It must win over the placeholder in .env, or
  // OAuth builds its callback URL on the wrong host.
  const result = envSchema.safeParse({
    ...source,
    SHOPIFY_APP_URL: source.APP_URL ?? source.SHOPIFY_APP_URL,
  });

  if (!result.success) {
    throw new Error(
      `Invalid environment configuration:\n${formatIssues(result.error)}\n\n` +
        'Copy .env.example to .env and fill in the blanks. The Shopify values\n' +
        'come from `shopify app env show` once the app is linked.',
    );
  }

  const parsed = result.data;

  return {
    ...parsed,
    hostName: new URL(parsed.SHOPIFY_APP_URL).host,
    isProduction: parsed.NODE_ENV === 'production',
    isTest: parsed.NODE_ENV === 'test',
  };
}

/** The validated environment for this process. */
export const env: Env = parseEnv();
