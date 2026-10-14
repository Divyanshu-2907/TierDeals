import { z } from 'zod';

import type { Decision } from './evaluator.js';
import type { RuleType } from './rule-config.js';
import type { RuleDto, SyncStatus } from './rule-dto.js';
import type { RuleStatus } from './rule-status.js';

/** Enough for a realistic cart without letting one request do unbounded work. */
export const MAX_DEBUG_LINES = 50;

const collectionId = z
  .string()
  .regex(/^gid:\/\/shopify\/Collection\/\d+$/, 'Must be a collection ID.');

/**
 * A sample cart for the Rule Debugger, built in the UI or pasted as JSON.
 *
 * Prices are in the buyer's (presentment) currency, as at checkout. Each
 * line's collections are looked up from Shopify, unless the line lists
 * `collectionIds` itself. A bug report always does, so it reproduces the
 * merchant's result even if the store's collections change later.
 */
export const debugCartSchema = z.object({
  presentmentCurrencyRate: z
    .number({ error: 'Enter a currency rate.' })
    .positive('Must be more than 0.')
    .default(1),
  lines: z
    .array(
      z.object({
        productId: z.string().regex(/^gid:\/\/shopify\/Product\/\d+$/, 'Must be a product ID.'),
        title: z.string().max(255).optional(),
        quantity: z
          .number({ error: 'Enter a quantity.' })
          .int('Must be a whole number.')
          .min(1, 'Must be at least 1.')
          .max(999, 'Must be at most 999.'),
        unitPrice: z.number({ error: 'Enter a price.' }).min(0, 'Must not be negative.'),
        collectionIds: z.array(collectionId).max(250).optional(),
      }),
    )
    .max(MAX_DEBUG_LINES, `Use at most ${MAX_DEBUG_LINES} lines.`),
});

export type DebugCartInput = z.input<typeof debugCartSchema>;
export type DebugCart = z.output<typeof debugCartSchema>;

/** A cart line after the server has looked up its collections. */
export interface DebugLine {
  productId: string;
  title: string;
  quantity: number;
  unitPrice: number;
  /** quantity × unitPrice, in the buyer's currency. */
  lineTotal: number;
  collections: { id: string; title: string | null }[];
}

export interface DebugRuleResult {
  ruleId: string;
  title: string;
  type: RuleType;
  status: RuleStatus;
  syncStatus: SyncStatus;
  /** `skipped`: the rule is off or outside its dates, so it was not evaluated. */
  outcome: 'applied' | 'not_applied' | 'skipped';
  /** Plain-English explanation, e.g. "Not applied: 2 items from Summer Sale, needs 3." */
  reason: string;
  /** The Function-equivalent decision; null if skipped or the config is invalid. */
  decision: Decision | null;
  /** Discount in the shop's currency; null if none or unknown (free shipping). */
  amount: number | null;
  /** Indexes into `cart.lines` that the discount applies to. */
  discountedLines: number[];
  /** Something that may make checkout differ from this result. */
  warning: string | null;
}

export interface DebugResult {
  evaluatedAt: string;
  shop: string;
  currencyCode: string;
  cart: {
    lines: DebugLine[];
    /** In the buyer's currency. */
    subtotal: number;
    presentmentCurrencyRate: number;
  };
  results: DebugRuleResult[];
  /** Observations across rules, e.g. two applied rules that do not combine. */
  notes: string[];
}

/** What "Copy as bug report" puts on the clipboard; also accepted as a pasted cart. */
export interface BugReport {
  kind: 'tierdeals-bug-report';
  version: 1;
  generatedAt: string;
  shop: string;
  currencyCode: string;
  /** Re-runnable: every line carries its collections. */
  cart: DebugCart;
  rules: RuleDto[];
  result: DebugResult;
}
