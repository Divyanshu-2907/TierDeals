# Two-minute demo script

Everything below uses the `tierdeals-dev` development store's sample products.
The amounts are worked out from their prices, so the video shows exact,
checkable numbers.

| Product | Price | Collections |
| --- | --- | --- |
| The Collection Snowboard: Hydrogen | ₹600.00 | Hydrogen, Automated Collection |
| The Collection Snowboard: Oxygen | ₹1,025.00 | Hydrogen |
| The Collection Snowboard: Liquid | ₹749.95 | Hydrogen, Automated Collection |
| The Complete Snowboard | ₹699.95 | Automated Collection (not Hydrogen) |
| The Minimal Snowboard | ₹885.95 | none |

## Before recording

- [ ] `shopify app dev --use-localhost` is running, and the app opens in the admin.
- [ ] **Snowboard bundle** exists and is on: Collection quantity tiers,
      collection **Hydrogen**, tiers **2+ → 10%** and **3+ → 20%**, no
      combinations.
- [ ] No **Spend & save** rule yet; it is created on camera. Delete any
      earlier subtotal rule.
- [ ] Every other discount is off, including the GraphiQL test discount
      "TierDeals test: collection tiers", so only TierDeals rules apply.
- [ ] The storefront cart is empty, and you are logged in to the store
      password page if it has one.
- [ ] GitHub's Actions tab for the repo is open in a tab, with a green run.
- [ ] Browser zoom around 110%; close unrelated tabs and notifications.

## Script

**0:00–0:10 · What it is**
> "TierDeals is a Shopify app for tiered discounts. Rules are managed in the
> admin, a Rust Shopify Function applies them at checkout, and a Rule Debugger
> explains every decision."

Show the **Discount rules** page: Snowboard bundle, *Active*, *In sync*.

**0:10–0:35 · Create a rule, with validation**
1. *Create rule* → Type **Cart subtotal tiers**.
2. Leave the title empty and enter tiers **₹1,000 → 10%** and **₹2,000 → 5%**.
   Click *Save*.
3. Point at the inline errors: *Enter a title.* and *A higher tier must give
   a bigger discount than the tier below it.*
4. Fix it: title **Spend & save**, tiers **₹1,000 → 5%** and **₹2,000 → 10%**.
   *Save* → toast *Rule created*; the list shows **In sync**.
   > "Every save goes to Postgres first, then to Shopify; if Shopify refuses,
   > the rule is flagged with Shopify's reason and a retry button."

**0:35–0:55 · Checkout**
1. Cart **Hydrogen + Oxygen + Liquid** (₹2,374.95) → checkout shows **Buy 3+,
   save 20%**: −₹120.00, −₹205.00, −₹149.99 (−₹474.99).
   > "Spend & save would only give ₹237.50 here. The two don't combine, so
   > Shopify picks the bigger saving."
2. Replace the cart with **The Complete Snowboard + The Minimal Snowboard**
   (₹1,585.90, neither in Hydrogen) → **5% off your order**, about −₹79.30.

**0:55–1:35 · Rule Debugger: a merchant report**
> "Say a merchant reports: 'my customer bought three Hydrogen boards but didn't
> get 20%.'"

1. *Rule Debugger* → *Add products*: **Hydrogen, Oxygen, The Complete
   Snowboard** → *Evaluate*.
2. Read the Snowboard bundle card: *"Applied: 2 items from Hydrogen reach the
   2+ tier, so 10% comes off those items. 1 more item would reach 20%."*
   > "The Complete Snowboard isn't in Hydrogen, so only two boards count."
3. Point at Spend & save (*Applied*, 10% of ₹2,324.95, −₹232.50) and the note
   that the two don't combine, so Shopify applies the bigger one.
4. *Copy as bug report* → the dialog opens (the admin blocks the clipboard) →
   *Download as .json*.
   > "Support attaches this file. Pasting it back reproduces the exact result,
   > even if the catalog changes."

**1:35–1:55 · How it stays correct**
1. In the editor, open `fixtures/rules/` and one case, e.g.
   `collection-quantity/one-below-lowest-threshold.json`.
   > "The debugger is a TypeScript port of the Rust Function. These 30 shared
   > cases run in both cargo test and Vitest, so they can't drift apart."
2. Switch to GitHub Actions: the green run with the **TypeScript** and **Rust
   Function** jobs.

**1:55–2:00 · Close**
> "React and Polaris in the admin, Express and Postgres behind it, Rust at
> checkout, and tests that keep the two decision engines honest."
