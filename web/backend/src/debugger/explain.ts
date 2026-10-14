import {
  evaluateRule,
  parseFunctionRule,
  ruleStatus,
  type CartFacts,
  type DebugLine,
  type DebugRuleResult,
  type Decision,
  type FunctionRule,
  type RuleDto,
  type Tier,
} from '@tierdeals/shared';

import { discountClassFor } from '../shopify/discount-gateway.js';

/**
 * Turns rules plus a sample cart into what the Rule Debugger shows: per rule,
 * whether it applies, which tier, how much comes off, and why, in words a
 * merchant or support agent can act on.
 *
 * The decision itself comes from the shared evaluator, which the shared
 * fixtures hold to the Rust Function's behaviour. This module only explains
 * it. Pure: no I/O, so it is tested directly.
 */

export interface ExplainContext {
  lines: DebugLine[];
  presentmentCurrencyRate: number;
  currencyCode: string;
  /** Titles for every collection a rule refers to; missing means deleted. */
  collectionTitles: ReadonlyMap<string, string>;
  now: Date;
}

export function explainRules(
  rules: readonly RuleDto[],
  context: ExplainContext,
): { results: DebugRuleResult[]; notes: string[] } {
  const results = rules.map((rule) => explainRule(rule, context));
  return { results, notes: combinationNotes(rules, results) };
}

export function explainRule(rule: RuleDto, context: ExplainContext): DebugRuleResult {
  const status = ruleStatus(rule, context.now);
  const base = {
    ruleId: rule.id,
    title: rule.title,
    type: rule.type,
    status,
    syncStatus: rule.sync.status,
    warning: syncWarning(rule),
  };
  const money = moneyFormatter(context.currencyCode);

  if (status !== 'active') {
    return {
      ...base,
      outcome: 'skipped',
      reason: skippedReason(rule, status),
      decision: null,
      amount: null,
      discountedLines: [],
    };
  }

  const parsed = parseFunctionRule(rule.config);
  if (!parsed.ok) {
    return {
      ...base,
      outcome: 'not_applied',
      reason: `Not applied: the saved configuration is invalid (${parsed.error}). Edit and save the rule to fix it.`,
      decision: null,
      amount: null,
      discountedLines: [],
    };
  }

  const facts = cartFacts(parsed.rule, context);
  const decision = evaluateRule(parsed.rule, facts);
  const discountedLines =
    decision.decision === 'product_discount'
      ? decision.lineIds.map((id) => Number(id.slice('line-'.length)))
      : [];

  return {
    ...base,
    outcome: decision.decision === 'not_applied' ? 'not_applied' : 'applied',
    reason: reasonFor(parsed.rule, decision, context, money),
    decision,
    amount: amountFor(decision, discountedLines, context),
    discountedLines,
  };
}

/** The cart as the Function would see it for this rule. */
function cartFacts(rule: FunctionRule, context: ExplainContext): CartFacts {
  const ruleCollections = new Set(
    rule.type === 'COLLECTION_QUANTITY_TIERS' ? rule.collectionIds : [],
  );
  return {
    lines: context.lines.map((line, index) => ({
      id: `line-${index}`,
      quantity: line.quantity,
      inCollection: line.collections.some((c) => ruleCollections.has(c.id)),
    })),
    subtotal: context.lines.reduce((sum, line) => sum + line.lineTotal, 0),
    presentmentCurrencyRate: context.presentmentCurrencyRate,
  };
}

/** The discount in the shop's currency, rounded to cents. */
function amountFor(
  decision: Decision,
  discountedLines: number[],
  context: ExplainContext,
): number | null {
  const toShop = (presentment: number) => presentment / context.presentmentCurrencyRate;
  switch (decision.decision) {
    case 'product_discount': {
      const total = discountedLines.reduce(
        (sum, index) => sum + (context.lines[index]?.lineTotal ?? 0),
        0,
      );
      return round(toShop(total) * (decision.percentage / 100));
    }
    case 'order_discount':
      return round(decision.subtotal * (decision.percentage / 100));
    // Shipping rates are only known at checkout.
    case 'free_shipping':
    case 'not_applied':
      return null;
  }
}

function reasonFor(
  rule: FunctionRule,
  decision: Decision,
  context: ExplainContext,
  money: (n: number) => string,
): string {
  if (decision.decision === 'not_applied' && decision.reason === 'invalid_currency_rate') {
    return 'Not applied: the currency rate must be more than 0.';
  }

  switch (rule.type) {
    case 'COLLECTION_QUANTITY_TIERS': {
      const from = collectionNames(rule.collectionIds, context.collectionTitles);
      if (decision.decision === 'product_discount') {
        const next = nextTier(rule.tiers, decision.qualifyingQuantity, decision.percentage);
        return (
          `Applied: ${items(decision.qualifyingQuantity)} from ${from} reach the ` +
          `${decision.threshold}+ tier, so ${decision.percentage}% comes off those items.` +
          (next
            ? ` ${items(next.threshold - decision.qualifyingQuantity, 'more')} would reach ${next.percentage}%.`
            : '')
        );
      }
      const measured =
        decision.decision === 'not_applied' && 'measured' in decision ? decision.measured : 0;
      return `Not applied: ${measured === 0 ? 'no items' : items(measured)} from ${from}, needs ${lowestThreshold(rule.tiers)}.`;
    }

    case 'CART_SUBTOTAL_TIERS': {
      if (decision.decision === 'order_discount') {
        const next = nextTier(rule.tiers, decision.subtotal, decision.percentage);
        return (
          `Applied: the subtotal of ${money(decision.subtotal)} reaches the ` +
          `${money(decision.threshold)} tier, so ${decision.percentage}% comes off the order.` +
          (next
            ? ` Spending ${money(next.threshold - decision.subtotal)} more would reach ${next.percentage}%.`
            : '')
        );
      }
      const measured =
        decision.decision === 'not_applied' && 'measured' in decision ? decision.measured : 0;
      return `Not applied: the subtotal is ${money(measured)}, needs ${money(lowestThreshold(rule.tiers))}.`;
    }

    case 'FREE_SHIPPING_THRESHOLD': {
      if (decision.decision === 'free_shipping') {
        return `Applied: the subtotal of ${money(decision.subtotal)} is at least ${money(rule.minSubtotal)}, so shipping is free.`;
      }
      const measured =
        decision.decision === 'not_applied' && 'measured' in decision ? decision.measured : 0;
      return `Not applied: the subtotal is ${money(measured)}, needs ${money(rule.minSubtotal)} for free shipping.`;
    }
  }
}

function skippedReason(rule: RuleDto, status: 'inactive' | 'scheduled' | 'expired'): string {
  switch (status) {
    case 'inactive':
      return 'Skipped: the rule is switched off.';
    case 'scheduled':
      return `Skipped: the rule starts on ${formatDate(rule.startsAt)}.`;
    case 'expired':
      return `Skipped: the rule ended on ${formatDate(rule.endsAt ?? rule.startsAt)}.`;
  }
}

function syncWarning(rule: RuleDto): string | null {
  switch (rule.sync.status) {
    case 'SYNCED':
      return null;
    case 'PENDING':
      return 'This rule has not reached Shopify yet, so checkout may not match this result.';
    case 'OUT_OF_SYNC':
      return 'Shopify has an older version of this rule (its last sync failed), so checkout may not match this result.';
  }
}

const COMBINES_KEY = {
  PRODUCT: 'productDiscounts',
  ORDER: 'orderDiscounts',
  SHIPPING: 'shippingDiscounts',
} as const;

/**
 * Two applied discounts only both apply at checkout if each is set to
 * combine with the other's class. Otherwise Shopify picks for the customer.
 */
function combinationNotes(
  rules: readonly RuleDto[],
  results: readonly DebugRuleResult[],
): string[] {
  const applied = rules.filter((_, i) => results[i]?.outcome === 'applied');
  const notes: string[] = [];

  for (let i = 0; i < applied.length; i++) {
    for (let j = i + 1; j < applied.length; j++) {
      const a = applied[i]!;
      const b = applied[j]!;
      const combines =
        a.combinesWith[COMBINES_KEY[discountClassFor(b.type)]] &&
        b.combinesWith[COMBINES_KEY[discountClassFor(a.type)]];
      if (!combines) {
        notes.push(
          `“${a.title}” and “${b.title}” both apply, but they are not both set to combine with ` +
            'each other, so Shopify applies only one of them: whichever saves the customer more.',
        );
      }
    }
  }
  return notes;
}

// --- Formatting ---------------------------------------------------------------

function moneyFormatter(currencyCode: string): (n: number) => string {
  try {
    const format = new Intl.NumberFormat('en', { style: 'currency', currency: currencyCode });
    return (n) => format.format(n);
  } catch {
    // An unknown currency code should not break the debugger.
    return (n) => `${n.toFixed(2)} ${currencyCode}`;
  }
}

function formatDate(iso: string): string {
  return new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeZone: 'UTC' }).format(
    new Date(iso),
  );
}

function items(n: number, adjective = ''): string {
  const word = n === 1 ? 'item' : 'items';
  return adjective ? `${n} ${adjective} ${word}` : `${n} ${word}`;
}

function collectionNames(ids: readonly string[], titles: ReadonlyMap<string, string>): string {
  const names = ids.map((id) => titles.get(id) ?? 'a deleted collection');
  if (names.length <= 2) return names.join(' or ');
  if (names.length === 3) return `${names[0]}, ${names[1]} or ${names[2]}`;
  return `${names[0]}, ${names[1]} or ${names.length - 2} other collections`;
}

function lowestThreshold(tiers: readonly Tier[]): number {
  return Math.min(...tiers.map((t) => t.threshold));
}

/** The closest tier above `measured` that gives more than the current one. */
function nextTier(
  tiers: readonly Tier[],
  measured: number,
  currentPercentage: number,
): Tier | undefined {
  return tiers
    .filter((t) => t.threshold > measured && t.percentage > currentPercentage)
    .sort((a, b) => a.threshold - b.threshold)[0];
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}
