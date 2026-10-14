# Shared fixtures

These JSON files are the contract between the two implementations of the
TierDeals discount logic:

| Implementation | Language | Where it runs | Runs the fixtures in |
| --- | --- | --- | --- |
| The Function | Rust → WebAssembly | Shopify's checkout | `cargo test` (`src/parity_tests.rs`) |
| The Rule Debugger's evaluator | TypeScript | The Express server | Vitest (`web/shared/test/parity.test.ts`) |

Both read **the same files from `rules/`** and must reach the same decision.
That is what stops the Rule Debugger from confidently explaining a discount
that the real checkout would never apply, or the reverse. Adding a case here
tests both implementations at once.

## Format

```jsonc
{
  "description": "What the case shows, in one sentence.",
  // The rule config exactly as stored in the discount's metafield. It may be
  // malformed on purpose (see rules/invalid-config).
  "config": { "version": 1, "type": "COLLECTION_QUANTITY_TIERS", "...": "..." },
  // What the Function reads from its input query.
  "cart": {
    "lines": [{ "id": "gid://shopify/CartLine/1", "quantity": 2, "inCollection": true }],
    "subtotal": 120,               // in the buyer's (presentment) currency
    "presentmentCurrencyRate": 1   // presentment units per unit of shop currency
  },
  "expected": { "decision": "product_discount", "...": "..." }
}
```

`expected` is one of:

| `decision` | Other fields |
| --- | --- |
| `product_discount` | `percentage`, `threshold`, `qualifyingQuantity`, `lineIds` |
| `order_discount` | `percentage`, `threshold`, `subtotal` (shop currency) |
| `free_shipping` | `subtotal` (shop currency) |
| `not_applied` | `reason`: `below_threshold` with `measured` (item count or shop-currency subtotal), or `invalid_currency_rate` |
| `invalid_config` | none |

Numbers are compared with a tolerance of 1e-6, the same tolerance both
implementations use for threshold checks.

The fixtures assert the *decision*, not Shopify's operation JSON. The
decision is what the Rule Debugger explains, and turning it into operations
is covered separately by the Function's own tests.
