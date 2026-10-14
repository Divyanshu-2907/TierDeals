# Shared fixtures

These JSON files are the contract between the two implementations of the
TierDeals discount logic:

| Implementation | Language | Where it runs | Test runner |
| --- | --- | --- | --- |
| The Function | Rust → WebAssembly | Shopify's checkout | `cargo test` |
| The Debugger evaluator | TypeScript | Our Express server | `vitest` |

Both read **the same files from this folder** and must produce the same
result. That is what stops the Rule Debugger from confidently explaining a
discount that the real checkout would never apply.

Each fixture is one object:

```jsonc
{
  "name": "collection-tiers/exactly-at-threshold",
  "description": "3 items from the collection hits the 3+ tier, not the 2+ tier.",
  "config": { /* the rule config, as stored in the discount metafield */ },
  "cart":   { /* the Function input: lines, cost, collection membership */ },
  "expected": { /* discount operations both implementations must produce */ }
}
```

Populated in Phase 4, alongside the TypeScript evaluator.
