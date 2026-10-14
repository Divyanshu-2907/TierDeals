/**
 * A TypeScript port of the Rust Function's decision logic
 * (extensions/tierdeals-discount/src/rule.rs: `parse_rule` and `evaluate`),
 * used by the Rule Debugger to predict what checkout will do.
 *
 * It must decide exactly as the Function does, so it deliberately mirrors
 * the Function's parser rather than reusing the admin's Zod schema: the
 * schema is stricter, and a debugger that refused a config checkout accepts
 * would explain nothing. Both implementations run the cases in
 * /fixtures/rules (see test/parity.test.ts and the Function's
 * parity_tests.rs), which is what keeps them in step. Change one, change the
 * other, and add a fixture.
 */

/** Matches CONFIG_VERSION in the Function. */
const CONFIG_VERSION = 1;
/** Matches MAX_TIERS in the Function. */
const MAX_TIERS = 10;
/** Matches MONEY_EPSILON in the Function. */
const MONEY_EPSILON = 1e-6;

export interface Tier {
  /** An item count or an amount in the shop's currency. */
  threshold: number;
  percentage: number;
}

export type FunctionRule =
  | { type: 'COLLECTION_QUANTITY_TIERS'; collectionIds: string[]; tiers: Tier[] }
  | { type: 'CART_SUBTOTAL_TIERS'; tiers: Tier[] }
  | { type: 'FREE_SHIPPING_THRESHOLD'; minSubtotal: number };

export type ParseResult = { ok: true; rule: FunctionRule } | { ok: false; error: string };

/** What the Function knows about a cart. */
export interface CartFacts {
  lines: { id: string; quantity: number; inCollection: boolean }[];
  /** In the buyer's (presentment) currency. */
  subtotal: number;
  /** Presentment currency units per unit of shop currency. */
  presentmentCurrencyRate: number;
}

/** Mirrors the Function's `Decision`, in the fixtures' JSON shape. */
export type Decision =
  | {
      decision: 'product_discount';
      percentage: number;
      threshold: number;
      qualifyingQuantity: number;
      lineIds: string[];
    }
  | { decision: 'order_discount'; percentage: number; threshold: number; subtotal: number }
  | { decision: 'free_shipping'; subtotal: number }
  | { decision: 'not_applied'; reason: 'below_threshold'; measured: number }
  | { decision: 'not_applied'; reason: 'invalid_currency_rate' };

// --- Parsing (mirrors parse_rule) -------------------------------------------

class ConfigError extends Error {}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function finiteNumber(value: unknown, key: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new ConfigError(`"${key}" must be a finite number`);
  }
  return value;
}

function quantity(value: unknown, key: string): number {
  const n = finiteNumber(value, key);
  if (n < 1 || !Number.isInteger(n)) {
    throw new ConfigError(`"${key}" must be a whole number of at least 1`);
  }
  return n;
}

function amount(value: unknown, key: string): number {
  const n = finiteNumber(value, key);
  if (n < 0) throw new ConfigError(`"${key}" must not be negative`);
  return n;
}

function percentage(value: unknown): number {
  const n = finiteNumber(value, 'percentage');
  if (n <= 0 || n > 100) {
    throw new ConfigError('"percentage" must be greater than 0 and at most 100');
  }
  return n;
}

function tiers(
  config: Record<string, unknown>,
  thresholdKey: 'minQuantity' | 'minSubtotal',
): Tier[] {
  const items = config.tiers;
  if (!Array.isArray(items)) throw new ConfigError('"tiers" must be an array');
  if (items.length === 0 || items.length > MAX_TIERS) {
    throw new ConfigError(
      `"tiers" must have between 1 and ${MAX_TIERS} entries, got ${items.length}`,
    );
  }
  return items.map((item: unknown, index) => {
    try {
      if (!isObject(item)) throw new ConfigError('must be an object');
      return {
        threshold:
          thresholdKey === 'minQuantity'
            ? quantity(item[thresholdKey], thresholdKey)
            : amount(item[thresholdKey], thresholdKey),
        percentage: percentage(item.percentage),
      };
    } catch (error) {
      throw new ConfigError(`tiers[${index}]: ${(error as Error).message}`);
    }
  });
}

function collectionIds(config: Record<string, unknown>): string[] {
  const items = config.collectionIds;
  if (!Array.isArray(items)) throw new ConfigError('"collectionIds" must be an array');
  if (items.length === 0) throw new ConfigError('"collectionIds" must not be empty');
  return items.map((item: unknown) => {
    if (typeof item !== 'string' || !item.startsWith('gid://shopify/Collection/')) {
      throw new ConfigError('"collectionIds" entries must be collection GIDs');
    }
    return item;
  });
}

/** Parses a stored config the way the Function does. Never throws. */
export function parseFunctionRule(value: unknown): ParseResult {
  try {
    if (!isObject(value)) throw new ConfigError('config must be a JSON object');

    if (!('version' in value)) throw new ConfigError('config is missing "version"');
    if (value.version !== CONFIG_VERSION) {
      throw new ConfigError(`unsupported config version, expected ${CONFIG_VERSION}`);
    }
    if (typeof value.type !== 'string') {
      throw new ConfigError('config is missing a string "type"');
    }

    switch (value.type) {
      case 'COLLECTION_QUANTITY_TIERS':
        return {
          ok: true,
          rule: {
            type: value.type,
            collectionIds: collectionIds(value),
            tiers: tiers(value, 'minQuantity'),
          },
        };
      case 'CART_SUBTOTAL_TIERS':
        return { ok: true, rule: { type: value.type, tiers: tiers(value, 'minSubtotal') } };
      case 'FREE_SHIPPING_THRESHOLD':
        return {
          ok: true,
          rule: { type: value.type, minSubtotal: amount(value.minSubtotal, 'minSubtotal') },
        };
      default:
        throw new ConfigError(`unknown rule type "${value.type}"`);
    }
  } catch (error) {
    if (error instanceof ConfigError) return { ok: false, error: error.message };
    throw error;
  }
}

// --- Evaluation (mirrors evaluate) ------------------------------------------

function meets(value: number, threshold: number): boolean {
  return value + MONEY_EPSILON >= threshold;
}

/**
 * Of the tiers `value` meets, the one with the highest percentage (ties go to
 * the higher threshold). At most one tier applies; tiers never stack.
 */
export function bestTier(tierList: readonly Tier[], value: number): Tier | undefined {
  let best: Tier | undefined;
  for (const tier of tierList) {
    if (!meets(value, tier.threshold)) continue;
    if (
      best === undefined ||
      tier.percentage > best.percentage ||
      (tier.percentage === best.percentage && tier.threshold > best.threshold)
    ) {
      best = tier;
    }
  }
  return best;
}

/** Null for a rate that cannot be divided by. */
export function toShopCurrency(presentmentAmount: number, rate: number): number | null {
  return Number.isFinite(rate) && rate > 0 ? presentmentAmount / rate : null;
}

export function evaluateRule(rule: FunctionRule, cart: CartFacts): Decision {
  switch (rule.type) {
    case 'COLLECTION_QUANTITY_TIERS': {
      const qualifying = cart.lines.filter((line) => line.inCollection && line.quantity > 0);
      const qualifyingQuantity = qualifying.reduce((sum, line) => sum + line.quantity, 0);
      const tier = bestTier(rule.tiers, qualifyingQuantity);
      if (tier === undefined) {
        return { decision: 'not_applied', reason: 'below_threshold', measured: qualifyingQuantity };
      }
      return {
        decision: 'product_discount',
        percentage: tier.percentage,
        threshold: tier.threshold,
        qualifyingQuantity,
        lineIds: qualifying.map((line) => line.id),
      };
    }

    case 'CART_SUBTOTAL_TIERS': {
      const subtotal = toShopCurrency(cart.subtotal, cart.presentmentCurrencyRate);
      if (subtotal === null) return { decision: 'not_applied', reason: 'invalid_currency_rate' };
      const tier = bestTier(rule.tiers, subtotal);
      if (tier === undefined) {
        return { decision: 'not_applied', reason: 'below_threshold', measured: subtotal };
      }
      return {
        decision: 'order_discount',
        percentage: tier.percentage,
        threshold: tier.threshold,
        subtotal,
      };
    }

    case 'FREE_SHIPPING_THRESHOLD': {
      const subtotal = toShopCurrency(cart.subtotal, cart.presentmentCurrencyRate);
      if (subtotal === null) return { decision: 'not_applied', reason: 'invalid_currency_rate' };
      return meets(subtotal, rule.minSubtotal)
        ? { decision: 'free_shipping', subtotal }
        : { decision: 'not_applied', reason: 'below_threshold', measured: subtotal };
    }
  }
}
