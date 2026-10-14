import { RULE_TYPE_LABELS, type DebugResult, type DebugRuleResult } from '@tierdeals/shared';

const OUTCOME: Record<
  DebugRuleResult['outcome'],
  { label: string; tone: 'success' | 'neutral' | 'info' }
> = {
  applied: { label: 'Applied', tone: 'success' },
  not_applied: { label: 'Not applied', tone: 'neutral' },
  skipped: { label: 'Skipped', tone: 'info' },
};

function formatMoney(amount: number, currencyCode: string): string {
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency: currencyCode }).format(
      amount,
    );
  } catch {
    return `${amount.toFixed(2)} ${currencyCode}`;
  }
}

/** One card per rule: outcome, reason, amount and any warning. */
export function DebugResults({ result }: { result: DebugResult }) {
  const appliedFirst = [...result.results].sort((a, b) => order(a.outcome) - order(b.outcome));

  return (
    <s-section heading="Results">
      <s-stack gap="base">
        <s-paragraph color="subdued">
          Subtotal {formatMoney(result.cart.subtotal, result.currencyCode)} across{' '}
          {result.cart.lines.length} {result.cart.lines.length === 1 ? 'line' : 'lines'}. Evaluated
          the same way the checkout Function decides.
        </s-paragraph>

        {result.notes.map((note) => (
          <s-banner key={note} tone="info">
            {note}
          </s-banner>
        ))}

        {result.results.length === 0 && (
          <s-paragraph>There are no rules yet, so nothing can apply.</s-paragraph>
        )}

        {appliedFirst.map((rule) => (
          <s-box key={rule.ruleId} border="base" borderRadius="base" padding="base">
            <s-stack gap="small-200">
              <s-stack direction="inline" gap="small" alignItems="center">
                <s-heading>{rule.title}</s-heading>
                <s-badge tone={OUTCOME[rule.outcome].tone}>{OUTCOME[rule.outcome].label}</s-badge>
                <s-text color="subdued">{RULE_TYPE_LABELS[rule.type]}</s-text>
              </s-stack>
              <s-paragraph>{rule.reason}</s-paragraph>
              {rule.amount !== null && (
                <s-text type="strong">
                  −{formatMoney(rule.amount, result.currencyCode)}
                  {rule.discountedLines.length > 0 &&
                    ` on ${rule.discountedLines
                      .map((i) => result.cart.lines[i]?.title ?? `line ${i + 1}`)
                      .join(', ')}`}
                </s-text>
              )}
              {rule.warning !== null && <s-text tone="caution">{rule.warning}</s-text>}
            </s-stack>
          </s-box>
        ))}
      </s-stack>
    </s-section>
  );
}

function order(outcome: DebugRuleResult['outcome']): number {
  return outcome === 'applied' ? 0 : outcome === 'not_applied' ? 1 : 2;
}
