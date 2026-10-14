import {
  debugCartSchema,
  fieldErrors,
  type BugReport,
  type DebugCart,
  type DebugResult,
  type RuleDto,
} from '@tierdeals/shared';

/**
 * The Rule Debugger's sample cart, as edited in the UI, and its conversions:
 * to the API's cart, from pasted JSON, and into a bug report.
 */

export interface CartLineRow {
  /** Stable React key. */
  key: number;
  productId: string;
  title: string;
  quantity: string;
  unitPrice: string;
  /** Set when the line came from pasted JSON that listed its collections. */
  collectionIds?: string[];
}

export interface CartFormValues {
  lines: CartLineRow[];
  presentmentCurrencyRate: string;
}

let nextKey = 1;

export function newLine(fields: Omit<CartLineRow, 'key'>): CartLineRow {
  return { key: nextKey++, ...fields };
}

export const emptyCart = (): CartFormValues => ({ lines: [], presentmentCurrencyRate: '1' });

function toNumber(value: string): number | undefined {
  return value.trim() === '' ? undefined : Number(value);
}

export type CartValidation =
  { ok: true; cart: DebugCart } | { ok: false; errors: Record<string, string> };

/** Validates the form with the same schema the API uses. */
export function validateCart(values: CartFormValues): CartValidation {
  const result = debugCartSchema.safeParse({
    presentmentCurrencyRate: toNumber(values.presentmentCurrencyRate),
    lines: values.lines.map((line) => ({
      productId: line.productId,
      title: line.title,
      quantity: toNumber(line.quantity),
      unitPrice: toNumber(line.unitPrice),
      ...(line.collectionIds === undefined ? {} : { collectionIds: line.collectionIds }),
    })),
  });
  return result.success
    ? { ok: true, cart: result.data }
    : { ok: false, errors: fieldErrors(result.error.issues) };
}

export type PasteResult = { ok: true; values: CartFormValues } | { ok: false; error: string };

/**
 * Accepts either a bare cart or a whole bug report (whose `cart` is used),
 * so a report pasted from a support ticket re-runs as-is.
 */
export function parsePastedCart(text: string): PasteResult {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return { ok: false, error: 'That is not valid JSON.' };
  }

  const candidate =
    typeof json === 'object' &&
    json !== null &&
    'kind' in json &&
    json.kind === 'tierdeals-bug-report'
      ? (json as { cart?: unknown }).cart
      : json;

  const result = debugCartSchema.safeParse(candidate);
  if (!result.success) {
    const [path, message] = Object.entries(fieldErrors(result.error.issues))[0] ?? [
      '',
      'Invalid cart.',
    ];
    return { ok: false, error: path ? `${path}: ${message}` : message };
  }

  return {
    ok: true,
    values: {
      presentmentCurrencyRate: String(result.data.presentmentCurrencyRate),
      lines: result.data.lines.map((line) =>
        newLine({
          productId: line.productId,
          title: line.title ?? line.productId,
          quantity: String(line.quantity),
          unitPrice: String(line.unitPrice),
          ...(line.collectionIds === undefined ? {} : { collectionIds: line.collectionIds }),
        }),
      ),
    },
  };
}

/**
 * Everything needed to reproduce a result elsewhere: the cart with each
 * line's collections filled in, the rules as they were, and the result.
 */
export function buildBugReport(
  result: DebugResult,
  rules: RuleDto[],
  generatedAt: Date = new Date(),
): BugReport {
  return {
    kind: 'tierdeals-bug-report',
    version: 1,
    generatedAt: generatedAt.toISOString(),
    shop: result.shop,
    currencyCode: result.currencyCode,
    cart: {
      presentmentCurrencyRate: result.cart.presentmentCurrencyRate,
      lines: result.cart.lines.map((line) => ({
        productId: line.productId,
        title: line.title,
        quantity: line.quantity,
        unitPrice: line.unitPrice,
        collectionIds: line.collections.map((c) => c.id),
      })),
    },
    rules,
    result,
  };
}
