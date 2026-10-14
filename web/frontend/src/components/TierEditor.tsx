import { MAX_TIERS, type RuleType } from '@tierdeals/shared';

import { newTierRow, thresholdKey, type TierRow } from '../rules/rule-form';
import { fieldValue } from '../ui/events';
import { fieldError } from '../ui/field-error';

interface TierEditorProps {
  type: Exclude<RuleType, 'FREE_SHIPPING_THRESHOLD'>;
  tiers: TierRow[];
  onChange: (tiers: TierRow[]) => void;
  /** Form errors keyed by schema path, e.g. `config.tiers.1.percentage`. */
  errors: Record<string, string>;
}

/**
 * Rows of "threshold → percentage". Tiers can be entered in any order; the
 * highest one the cart meets applies, and they never stack.
 */
export function TierEditor({ type, tiers, onChange, errors }: TierEditorProps) {
  const key = thresholdKey(type);
  const isQuantity = type === 'COLLECTION_QUANTITY_TIERS';

  function update(index: number, change: Partial<TierRow>) {
    onChange(tiers.map((row, i) => (i === index ? { ...row, ...change } : row)));
  }

  return (
    <s-stack gap="base">
      {errors['config.tiers'] && <s-text tone="critical">{errors['config.tiers']}</s-text>}

      {tiers.map((row, index) => (
        <s-grid key={row.key} gridTemplateColumns="1fr 1fr auto" gap="base" alignItems="start">
          {isQuantity ? (
            <s-number-field
              label="Minimum items"
              labelAccessibilityVisibility={index === 0 ? 'visible' : 'exclusive'}
              value={row.threshold}
              min={1}
              step={1}
              inputMode="numeric"
              {...fieldError(errors, `config.tiers.${index}.${key}`)}
              onInput={(e) => update(index, { threshold: fieldValue(e) })}
            />
          ) : (
            // A money field shows the shop's currency by default, which is
            // the currency thresholds are configured in.
            <s-money-field
              label="Minimum subtotal"
              labelAccessibilityVisibility={index === 0 ? 'visible' : 'exclusive'}
              value={row.threshold}
              min={0}
              {...fieldError(errors, `config.tiers.${index}.${key}`)}
              onInput={(e) => update(index, { threshold: fieldValue(e) })}
            />
          )}

          <s-number-field
            label="Discount"
            labelAccessibilityVisibility={index === 0 ? 'visible' : 'exclusive'}
            value={row.percentage}
            min={0}
            max={100}
            step={0.5}
            inputMode="decimal"
            suffix="%"
            {...fieldError(errors, `config.tiers.${index}.percentage`)}
            onInput={(e) => update(index, { percentage: fieldValue(e) })}
          />

          <s-box paddingBlockStart={index === 0 ? 'large-200' : 'none'}>
            <s-button
              variant="tertiary"
              icon="delete"
              accessibilityLabel={`Remove tier ${index + 1}`}
              disabled={tiers.length === 1}
              onClick={() => onChange(tiers.filter((_, i) => i !== index))}
            />
          </s-box>
        </s-grid>
      ))}

      <s-stack direction="inline" gap="base" alignItems="center">
        <s-button
          icon="plus"
          disabled={tiers.length >= MAX_TIERS}
          onClick={() => onChange([...tiers, newTierRow()])}
        >
          Add tier
        </s-button>
        <s-text color="subdued">
          The highest tier the cart reaches applies. Tiers never stack.
        </s-text>
      </s-stack>
    </s-stack>
  );
}
