# Shopify setup

These are the steps that need your Shopify login. Run them yourself — they
create real resources in your Partner organization.

Verified against Shopify CLI **4.9.x** (October 2026). If the CLI prompts for
something not described here, trust the CLI.

---

## 1. Prerequisites

- A [Shopify Partner account](https://partners.shopify.com/signup) (free).
- A **development store** in that organization. Create one from the Partner
  Dashboard → Stores → Add store → Development store.
- The Shopify CLI. It ships as an npm package; no global install needed if you
  prefer `npx`:

  ```bash
  npm install -g @shopify/cli@latest
  shopify version
  ```

- **Rust + the WebAssembly target** (needed from Phase 2 onward):

  ```bash
  # Install Rust from https://rustup.rs, then:
  rustup target add wasm32-unknown-unknown
  cargo install cargo-wasi    # only if the CLI asks for it
  ```

- **Docker Desktop**, running, for the local Postgres.

---

## 2. Log in

```bash
shopify auth login
```

## 3. Create the app and link it to this repo

This repo already has its own structure, so we do **not** use
`shopify app init` (which scaffolds a fresh template app). Instead we link an
app to the existing directory, which writes a `shopify.app.toml` here:

```bash
# from the repo root
shopify app config link
```

Answer the prompts:

- **Organization** — your Partner organization.
- **App** — choose **“Create a new app”** and name it `TierDeals`.

This creates `shopify.app.toml` in the repo root.

## 4. Check the generated config

Open `shopify.app.toml` and make sure it contains these values. Edit if needed:

```toml
name = "TierDeals"
application_url = "https://example.com"   # overwritten by `shopify app dev`
embedded = true

[access_scopes]
scopes = "write_discounts,read_discounts,read_products,read_orders"

[auth]
redirect_urls = [
  "https://example.com/api/auth/callback"
]

[webhooks]
api_version = "2026-10"

[build]
automatically_update_urls_on_dev = true
include_config_on_deploy = true
```

`shopify app dev` rewrites `application_url` and `redirect_urls` to the tunnel
URL each run, which is why their placeholder values do not matter.

> The scopes must match `SCOPES` in your `.env`. `read_orders` is for the
> Phase 5 `orders/create` webhook; `write_discounts` is what lets the app
> create automatic discounts.

## 5. Pull the credentials into `.env`

```bash
cp .env.example .env     # if you have not already
shopify app env show
```

Copy `SHOPIFY_API_KEY` and `SHOPIFY_API_SECRET` from that output into `.env`.

> When you run the app via `shopify app dev`, the CLI injects these variables
> itself. Putting them in `.env` as well means `npm run dev`, the tests and CI
> work without the CLI.

## 6. Start the database and migrate

```bash
npm run db:up        # requires Docker Desktop to be running
npm run db:migrate
```

## 7. Run the app

```bash
shopify app dev
```

The CLI opens a tunnel, rewrites the app URLs, and prints a preview link.
Open it, pick your development store, and install the app.

---

## Later phases

| Phase | Command |
| --- | --- |
| 2 | `shopify app generate extension --template discount` (choose **Rust**) |
| 2 | `shopify app function run` / `shopify app function replay` |
| 3+ | `shopify app dev` |
| 6 | `shopify app deploy` |

---

## Troubleshooting

**`shopify app config link` says the directory is not an app.**
Run it from the repo root, where `package.json` and `web/shopify.web.toml`
live.

**The app loads blank in the admin.**
Check that `embedded = true` in `shopify.app.toml` and that the browser is not
blocking third-party cookies for `admin.shopify.com`.

**OAuth loops back to the install screen.**
Usually the scopes in `shopify.app.toml` and `.env` have drifted apart.
Make them match and reinstall the app.
