import type { DebugCart, DebugLine, DebugResult } from '@tierdeals/shared';

import { explainRules } from '../debugger/explain.js';
import type { PrismaClient } from '../generated/prisma/client.js';
import { ValidationError } from '../lib/errors.js';
import type { Catalog } from '../shopify/catalog.js';
import { toDto } from './rule-service.js';

export interface DebuggerServiceDeps {
  prisma: PrismaClient;
  shop: string;
  catalog: Catalog;
}

/**
 * The Rule Debugger: evaluates every one of the shop's rules against a sample
 * cart. The only I/O is here (rules from Postgres; products, collections and
 * the currency from Shopify); the decisions and explanations are pure, in
 * debugger/explain.ts.
 */
export function createDebuggerService({ prisma, shop, catalog }: DebuggerServiceDeps) {
  return {
    async evaluate(cart: DebugCart, now: Date = new Date()): Promise<DebugResult> {
      const rules = (
        await prisma.rule.findMany({ where: { shop }, orderBy: { createdAt: 'desc' } })
      ).map((rule) => toDto(rule, now));

      // Lines that list their collections (e.g. from a pasted bug report) are
      // taken as given; the rest are looked up.
      const toLookUp = cart.lines
        .filter((l) => l.collectionIds === undefined)
        .map((l) => l.productId);
      const [currencyCode, products] = await Promise.all([
        catalog.shopCurrency(),
        catalog.products(toLookUp),
      ]);
      const productsById = new Map(products.map((p) => [p.id, p]));

      const missing: Record<string, string> = {};
      cart.lines.forEach((line, index) => {
        if (line.collectionIds === undefined && !productsById.has(line.productId)) {
          missing[`lines.${index}.productId`] = 'This product no longer exists in the store.';
        }
      });
      if (Object.keys(missing).length > 0) {
        throw new ValidationError('Some products in the cart could not be found.', {
          fields: missing,
        });
      }

      // Titles for every collection mentioned by a rule or a line.
      const collectionIds = new Set<string>();
      for (const rule of rules) {
        if (rule.config.type === 'COLLECTION_QUANTITY_TIERS') {
          rule.config.collectionIds.forEach((id) => collectionIds.add(id));
        }
      }
      for (const line of cart.lines) line.collectionIds?.forEach((id) => collectionIds.add(id));
      const collectionTitles = new Map<string, string>();
      for (const product of products) {
        product.collections.forEach((c) => collectionTitles.set(c.id, c.title));
      }
      const unknown = [...collectionIds].filter((id) => !collectionTitles.has(id));
      for (const c of await catalog.collections(unknown)) collectionTitles.set(c.id, c.title);

      const lines: DebugLine[] = cart.lines.map((line) => {
        const product = productsById.get(line.productId);
        const ids = line.collectionIds ?? product?.collections.map((c) => c.id) ?? [];
        return {
          productId: line.productId,
          title: line.title ?? product?.title ?? line.productId,
          quantity: line.quantity,
          unitPrice: line.unitPrice,
          lineTotal: Math.round(line.quantity * line.unitPrice * 100) / 100,
          collections: ids.map((id) => ({ id, title: collectionTitles.get(id) ?? null })),
        };
      });

      const { results, notes } = explainRules(rules, {
        lines,
        presentmentCurrencyRate: cart.presentmentCurrencyRate,
        currencyCode,
        collectionTitles,
        now,
      });

      return {
        evaluatedAt: now.toISOString(),
        shop,
        currencyCode,
        cart: {
          lines,
          subtotal: Math.round(lines.reduce((sum, l) => sum + l.lineTotal, 0) * 100) / 100,
          presentmentCurrencyRate: cart.presentmentCurrencyRate,
        },
        results,
        notes,
      };
    },
  };
}
