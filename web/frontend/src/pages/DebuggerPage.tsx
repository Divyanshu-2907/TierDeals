import type { DebugResult } from '@tierdeals/shared';
import { useState } from 'react';

import { ApiError } from '../api/client';
import { useEvaluateCart, useRules } from '../api/hooks';
import { DebugResults } from '../debugger/DebugResults';
import {
  buildBugReport,
  emptyCart,
  newLine,
  parsePastedCart,
  validateCart,
  type CartFormValues,
  type CartLineRow,
} from '../debugger/debug-cart';
import { fieldValue } from '../ui/events';
import { fieldError } from '../ui/field-error';
import { hideModal, showModal } from '../ui/modal';
import { showError } from '../ui/toast';

const PASTE_MODAL_ID = 'paste-cart-modal';
const REPORT_MODAL_ID = 'bug-report-modal';

/**
 * Rule Debugger: build or paste a sample cart and see, for every rule,
 * whether it applies and why. This is how a merchant's "my discount didn't
 * apply" gets reproduced and explained.
 */
export function DebuggerPage() {
  const rules = useRules();
  const evaluate = useEvaluateCart();

  const [cart, setCart] = useState<CartFormValues>(emptyCart);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [result, setResult] = useState<DebugResult | null>(null);
  const [pasteText, setPasteText] = useState('');
  const [pasteError, setPasteError] = useState<string | null>(null);
  const [reportText, setReportText] = useState('');

  function updateLine(key: number, change: Partial<CartLineRow>) {
    setCart((c) => ({
      ...c,
      lines: c.lines.map((line) => (line.key === key ? { ...line, ...change } : line)),
    }));
  }

  async function addProducts() {
    const picked = await shopify.resourcePicker({ type: 'product', multiple: true });
    if (picked === undefined) return;
    setCart((c) => ({
      ...c,
      lines: [
        ...c.lines,
        ...picked.map((product) =>
          newLine({
            productId: product.id,
            title: product.title,
            quantity: '1',
            unitPrice: product.variants[0]?.price ?? '',
          }),
        ),
      ],
    }));
  }

  async function run() {
    const validation = validateCart(cart);
    if (!validation.ok) {
      setErrors(validation.errors);
      return;
    }
    setErrors({});
    try {
      setResult(await evaluate.mutateAsync(validation.cart));
    } catch (error) {
      if (error instanceof ApiError) setErrors(error.fields);
      showError(error);
    }
  }

  function loadPasted() {
    const parsed = parsePastedCart(pasteText);
    if (!parsed.ok) {
      // Keep the modal open so the error shows next to the JSON.
      setPasteError(parsed.error);
      return;
    }
    setPasteError(null);
    setCart(parsed.values);
    setResult(null);
    setErrors({});
    hideModal(PASTE_MODAL_ID);
    shopify.toast.show('Cart loaded. Evaluate it to see the results.');
  }

  async function copyBugReport() {
    if (!result) return;
    const text = JSON.stringify(buildBugReport(result, rules.data ?? []), null, 2);
    try {
      await navigator.clipboard.writeText(text);
      shopify.toast.show('Bug report copied');
    } catch {
      // The admin iframe may not allow clipboard access: show it to copy by hand.
      setReportText(text);
      showModal(REPORT_MODAL_ID);
    }
  }

  return (
    <s-page heading="Rule Debugger">
      <s-button
        slot="primary-action"
        variant="primary"
        loading={evaluate.isPending}
        onClick={() => void run()}
      >
        Evaluate
      </s-button>
      <s-button slot="secondary-actions" commandFor={PASTE_MODAL_ID} command="--show">
        Paste cart JSON
      </s-button>
      <s-button
        slot="secondary-actions"
        disabled={result === null}
        onClick={() => void copyBugReport()}
      >
        Copy as bug report
      </s-button>

      <s-section heading="Sample cart">
        <s-stack gap="base">
          <s-paragraph color="subdued">
            Add the products from a customer’s cart, or paste a cart or bug report as JSON. Each
            product’s collections are looked up from the store.
          </s-paragraph>

          {cart.lines.length > 0 && (
            <s-table>
              <s-table-header-row>
                <s-table-header listSlot="primary">Product</s-table-header>
                <s-table-header>Quantity</s-table-header>
                <s-table-header>Unit price</s-table-header>
                <s-table-header>
                  <s-text accessibilityVisibility="exclusive">Remove</s-text>
                </s-table-header>
              </s-table-header-row>
              <s-table-body>
                {cart.lines.map((line, index) => (
                  <s-table-row key={line.key}>
                    <s-table-cell>
                      <s-stack gap="small-300">
                        <s-text>{line.title}</s-text>
                        {errors[`lines.${index}.productId`] !== undefined && (
                          <s-text tone="critical">{errors[`lines.${index}.productId`]}</s-text>
                        )}
                        {line.collectionIds !== undefined && (
                          <s-text color="subdued">Collections from pasted JSON</s-text>
                        )}
                      </s-stack>
                    </s-table-cell>
                    <s-table-cell>
                      <s-number-field
                        label="Quantity"
                        labelAccessibilityVisibility="exclusive"
                        value={line.quantity}
                        min={1}
                        max={999}
                        step={1}
                        inputMode="numeric"
                        {...fieldError(errors, `lines.${index}.quantity`)}
                        onInput={(e) => updateLine(line.key, { quantity: fieldValue(e) })}
                      />
                    </s-table-cell>
                    <s-table-cell>
                      <s-money-field
                        label="Unit price"
                        labelAccessibilityVisibility="exclusive"
                        value={line.unitPrice}
                        min={0}
                        {...fieldError(errors, `lines.${index}.unitPrice`)}
                        onInput={(e) => updateLine(line.key, { unitPrice: fieldValue(e) })}
                      />
                    </s-table-cell>
                    <s-table-cell>
                      <s-button
                        variant="tertiary"
                        icon="delete"
                        accessibilityLabel={`Remove ${line.title}`}
                        onClick={() =>
                          setCart((c) => ({
                            ...c,
                            lines: c.lines.filter((l) => l.key !== line.key),
                          }))
                        }
                      />
                    </s-table-cell>
                  </s-table-row>
                ))}
              </s-table-body>
            </s-table>
          )}

          <s-stack direction="inline" gap="base">
            <s-button icon="plus" onClick={() => void addProducts()}>
              Add products
            </s-button>
            {cart.lines.length > 0 && (
              <s-button variant="tertiary" onClick={() => setCart(emptyCart())}>
                Clear cart
              </s-button>
            )}
          </s-stack>

          <s-number-field
            label="Currency rate"
            details="Buyer’s currency units per unit of shop currency. Leave at 1 for a cart in the shop’s currency."
            value={cart.presentmentCurrencyRate}
            min={0}
            step={0.0001}
            inputMode="decimal"
            {...fieldError(errors, 'presentmentCurrencyRate')}
            onInput={(e) => setCart((c) => ({ ...c, presentmentCurrencyRate: fieldValue(e) }))}
          />
        </s-stack>
      </s-section>

      {result !== null && <DebugResults result={result} />}

      <s-modal id={PASTE_MODAL_ID} heading="Paste a cart or bug report">
        <s-stack gap="base">
          <s-paragraph>
            Paste a cart, or a whole bug report copied from this page. Collections listed in the
            JSON are used as-is, so a report reproduces even if the store has changed since.
          </s-paragraph>
          <s-text-area
            label="JSON"
            rows={12}
            value={pasteText}
            {...(pasteError === null ? {} : { error: pasteError })}
            onInput={(e) => setPasteText(fieldValue(e))}
          />
        </s-stack>
        <s-button slot="primary-action" variant="primary" onClick={loadPasted}>
          Load cart
        </s-button>
        <s-button slot="secondary-actions" commandFor={PASTE_MODAL_ID} command="--hide">
          Cancel
        </s-button>
      </s-modal>

      <s-modal id={REPORT_MODAL_ID} heading="Bug report" size="large">
        <s-stack gap="base">
          <s-paragraph>
            The clipboard is not available here. Select the text and copy it.
          </s-paragraph>
          <s-text-area label="Bug report JSON" rows={16} readOnly value={reportText} />
        </s-stack>
        <s-button slot="secondary-actions" commandFor={REPORT_MODAL_ID} command="--hide">
          Close
        </s-button>
      </s-modal>
    </s-page>
  );
}
