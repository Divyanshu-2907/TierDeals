# Shopify setup

These are the steps that need your Shopify login. Run them yourself — they
create real resources in your Partner organization.

Verified against Shopify CLI **4.9.x** (October 2026). If the CLI prompts for
something not described here, trust the CLI.

---

## 1. Prerequisites

- A [Shopify Partner account](https://partners.shopify.com/signup) (free).
- A **development store** in that organization. Apps and dev stores now live
  in the [Dev Dashboard](https://dev.shopify.com/dashboard/), which replaced
  the Partner Dashboard for app development: Stores → **Create store**.
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
  ```

  On Windows, Rust also needs the MSVC linker from the Visual Studio Build
  Tools ("Desktop development with C++" workload).

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
URL each run, which is why their placeholder values do not matter. The app
authenticates with token exchange (see step 8), so it never actually uses a
redirect URL.

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

The CLI opens a tunnel (or, with `--use-localhost`, a local HTTPS proxy),
rewrites the app URLs, and prints a preview link. Open it, pick your
development store, and install the app.

It runs two processes and builds the Function:

- **web-frontend**: the Vite dev server for the admin UI. The CLI proxy sends
  every request here, and Vite forwards `/api` to the backend.
- **web-backend**: the Express API on port 3000 (`http://localhost:3000/health`).

Edits to either reload automatically. Stop and restart `shopify app dev` after
changing any `shopify.*.toml` file.

## 8. Verify the install

The app authenticates with **token exchange**: Shopify installs it from the
scopes in `shopify.app.toml`, and the first API request from the embedded
admin UI swaps its App Bridge session token for an offline access token. There
are no OAuth routes. Open the app in the Shopify admin once, then confirm the
offline session was stored:

```bash
docker exec tierdeals-postgres psql -U tierdeals -d tierdeals -c "select id, shop, scope from shopify_sessions"
```

To call the API from a terminal once a session exists, mint a session token
from the app secret in `.env` (PowerShell shown):

```powershell
$token = npx tsx web/backend/scripts/session-token.ts <your-store>.myshopify.com
Invoke-RestMethod "http://localhost:3000/api/me" -Headers @{ Authorization = "Bearer $token" }
```

It should return your shop domain and scopes. A 401 means the token was
rejected, usually because `.env` has a different API key or secret.

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
Run it from the repo root, where `package.json` and `web/backend/shopify.web.toml`
live.

**The app loads blank in the admin.**
Check that `embedded = true` in `shopify.app.toml` and that the browser is not
blocking third-party cookies for `admin.shopify.com`.

**API requests fail with 401 or the app keeps reloading.**
Usually the scopes in `shopify.app.toml` and `.env` have drifted apart, or
`.env` holds another app's API key or secret. Make them match and restart
`shopify app dev`.
