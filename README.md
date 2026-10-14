# TierDeals

Tiered discount rules for Shopify. Merchants define discount logic in an
embedded admin UI; a Rust Shopify Function applies it at checkout.

> **Status:** in development, built in phases. Phases 1 and 2 are complete;
> Phase 3 (the rules admin) is built and in testing. See [Roadmap](#roadmap).

## What it does

Merchants create rules of three kinds:

1. **Collection quantity tiers** — buy N+ items from a collection, get Y% off
   those items (2+ → 10%, 3+ → 15%, 5+ → 25%).
2. **Cart subtotal tiers** — spend $A or more, get B% off the order.
3. **Free shipping threshold** — subtotal of $A or more ships free.

Each rule is stored in Postgres and mirrored to Shopify as an automatic app
discount whose configuration lives in a JSON metafield. The Function reads
that metafield at checkout, so discount logic changes without a redeploy.

The headline feature is a **Rule Debugger**: build a sample cart, and see for
every rule whether it matched, which tier applied, how much came off, and a
plain-English reason why not when it didn't.

## Architecture

Full diagram and write-up land in Phase 6. The short version:

```
React + Polaris admin  →  Express API  →  Postgres (rules, logs)
                                       →  Shopify Admin GraphQL API
                                              → automatic discount + JSON metafield
                                                     → Rust Function at checkout
orders/create webhook  →  Express  →  Postgres (discount application log)
```

## Repository layout

```
.
├── web/backend/          Express + TypeScript API, Prisma schema
├── web/frontend/         React + Vite admin (Polaris web components, App Bridge)
├── web/shared/           Zod rule schemas used by both the API and the admin
├── extensions/           Rust discount Function
├── fixtures/             Shared test fixtures, run by cargo AND vitest
├── docs/screenshots/     README screenshots
└── docker-compose.yml    Local Postgres
```

## Local setup

Prerequisites: Node 22.22+, Docker, Rust with the `wasm32-unknown-unknown`
target, and the Shopify CLI.

```bash
npm install
npm run db:up          # Postgres on localhost:5433
cp .env.example .env   # then fill in the Shopify values
npm run db:migrate
```

Shopify-side setup (requires a Partner account) is documented in
[docs/shopify-setup.md](docs/shopify-setup.md).

## Scripts

| Command | What it does |
| --- | --- |
| `shopify app dev` | Run the whole app (admin UI, API, Function) against a dev store |
| `npm run build` | Production build: shared schemas, API, then admin UI |
| `npm run lint` | ESLint across all workspaces |
| `npm test` | Vitest suites (the API tests need Postgres: `npm run db:up`) |
| `cargo test` | Function unit tests, run in `extensions/tierdeals-discount` |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run format` | Prettier |
| `npm run db:up` / `db:down` | Local Postgres lifecycle |
| `npm run db:migrate` | Apply Prisma migrations |

## Roadmap

- [x] **Phase 1** — repo skeleton, Postgres, Express + Prisma, env validation, tooling
- [x] **Phase 2** — Rust discount Function + `cargo test`
- [ ] **Phase 3** — Rules admin: CRUD API, Polaris UI, Shopify discount sync
- [ ] **Phase 4** — Rule Debugger, shared fixtures, cross-language parity tests
- [ ] **Phase 5** — `orders/create` webhook, application log, analytics
- [ ] **Phase 6** — CI, full README, demo

## Licence

MIT
