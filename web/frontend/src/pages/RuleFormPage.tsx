import { RULE_TYPES, RULE_TYPE_LABELS, type RuleDto, type RuleType } from '@tierdeals/shared';
import { useState } from 'react';
import { useNavigate, useParams } from 'react-router';

import { ApiError } from '../api/client';
import { useCollections, useCreateRule, useRetrySync, useRule, useUpdateRule } from '../api/hooks';
import { CollectionsField } from '../components/CollectionsField';
import { TierEditor } from '../components/TierEditor';
import {
  emptyForm,
  formFromRule,
  validateForm,
  withType,
  type CollectionRef,
  type RuleFormValues,
} from '../rules/rule-form';
import { fieldChecked, fieldValue } from '../ui/events';
import { fieldError } from '../ui/field-error';
import { showError } from '../ui/toast';
import { NotFoundPage } from './NotFoundPage';

function isRuleType(value: string): value is RuleType {
  return (RULE_TYPES as readonly string[]).includes(value);
}

const TYPE_DETAILS: Record<RuleType, string> = {
  COLLECTION_QUANTITY_TIERS:
    'Buy N or more items from chosen collections, get a percentage off those items.',
  CART_SUBTOTAL_TIERS: 'Spend a minimum amount, get a percentage off the order.',
  FREE_SHIPPING_THRESHOLD: 'Spend a minimum amount, get free shipping.',
};

/** /rules/new and /rules/:id. Loads the rule, then hands it to the form. */
export function RuleFormPage() {
  const { id } = useParams();
  const rule = useRule(id);

  if (id === undefined) return <RuleForm key="new" />;

  if (rule.isPending) {
    return (
      <s-page heading="Edit rule">
        <s-section>
          <s-stack alignItems="center" padding="large">
            <s-spinner accessibilityLabel="Loading rule" />
          </s-stack>
        </s-section>
      </s-page>
    );
  }

  if (rule.isError) {
    if (rule.error instanceof ApiError && rule.error.status === 404) return <NotFoundPage />;
    return (
      <s-page heading="Edit rule">
        <s-banner tone="critical" heading="The rule could not be loaded">
          {rule.error.message}
        </s-banner>
      </s-page>
    );
  }

  // Keyed by ID so a different rule starts with fresh form state.
  return <RuleForm key={rule.data.id} rule={rule.data} />;
}

function RuleForm({ rule }: { rule?: RuleDto }) {
  const navigate = useNavigate();
  const create = useCreateRule();
  const update = useUpdateRule(rule?.id ?? '');
  const retrySync = useRetrySync();

  const [values, setValues] = useState<RuleFormValues>(() =>
    rule ? formFromRule(rule) : emptyForm(),
  );
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);

  // Titles for the saved rule's collections. Newly picked ones already have
  // titles from the resource picker.
  const savedCollectionIds =
    rule?.config.type === 'COLLECTION_QUANTITY_TIERS' ? rule.config.collectionIds : [];
  const lookup = useCollections(savedCollectionIds);
  const collections: CollectionRef[] = values.collections.map((c) => ({
    id: c.id,
    title:
      c.title ??
      lookup.data?.find((found) => found.id === c.id)?.title ??
      (lookup.isPending ? 'Loading…' : null),
  }));

  const saving = create.isPending || update.isPending;

  function set<K extends keyof RuleFormValues>(key: K, value: RuleFormValues[K]) {
    setValues((current) => ({ ...current, [key]: value }));
  }

  async function save() {
    const result = validateForm(values);
    if (!result.ok) {
      setErrors(result.errors);
      setFormError('Fix the highlighted fields, then save again.');
      return;
    }
    setErrors({});
    setFormError(null);

    try {
      const saved = rule
        ? await update.mutateAsync(result.input)
        : await create.mutateAsync(result.input);

      if (saved.sync.status === 'OUT_OF_SYNC') {
        // Saved in TierDeals but not in Shopify: stay on the rule, where the
        // banner explains why and offers a retry.
        showError('Saved, but Shopify did not accept the change.');
        if (!rule) void navigate(`/rules/${saved.id}`, { replace: true });
        return;
      }

      shopify.toast.show(rule ? 'Rule saved' : 'Rule created');
      void navigate('/');
    } catch (error) {
      if (error instanceof ApiError) {
        setErrors(error.fields);
        setFormError(error.message);
      } else {
        setFormError('The rule could not be saved. Check your connection and try again.');
      }
    }
  }

  async function retry() {
    if (!rule) return;
    try {
      const synced = await retrySync.mutateAsync(rule.id);
      if (synced.sync.status === 'SYNCED') shopify.toast.show('Rule synced with Shopify');
      else showError(synced.sync.error ?? 'Shopify was not updated.');
    } catch (error) {
      showError(error);
    }
  }

  return (
    <s-page heading={rule ? rule.title : 'Create rule'}>
      <s-link slot="breadcrumb-actions" onClick={() => void navigate('/')}>
        Discount rules
      </s-link>
      <s-button
        slot="primary-action"
        variant="primary"
        loading={saving}
        onClick={() => void save()}
      >
        Save
      </s-button>
      <s-button slot="secondary-actions" onClick={() => void navigate('/')}>
        Cancel
      </s-button>

      {formError !== null && (
        <s-banner tone="critical" heading="The rule was not saved">
          {formError}
        </s-banner>
      )}

      {rule?.sync.status === 'OUT_OF_SYNC' && (
        <s-banner tone="warning" heading="Shopify does not have the latest version of this rule">
          {rule.sync.error}
          <s-button
            slot="secondary-actions"
            loading={retrySync.isPending}
            onClick={() => void retry()}
          >
            Retry sync
          </s-button>
        </s-banner>
      )}

      <s-section heading="Rule">
        <s-stack gap="base">
          <s-text-field
            label="Title"
            details="Shown to customers at checkout next to the discount."
            value={values.title}
            maxLength={255}
            {...fieldError(errors, 'title')}
            onInput={(e) => set('title', fieldValue(e))}
          />
          <s-select
            label="Type"
            value={values.type}
            disabled={rule !== undefined}
            details={
              rule
                ? 'A rule’s type cannot be changed. Create a new rule instead.'
                : TYPE_DETAILS[values.type]
            }
            {...fieldError(errors, 'config.type')}
            onChange={(e) => {
              // Read the value now: the event is finished by the time a state
              // updater runs, and its currentTarget is null by then.
              const type = fieldValue(e);
              if (isRuleType(type)) setValues((v) => withType(v, type));
            }}
          >
            {RULE_TYPES.map((type) => (
              <s-option key={type} value={type}>
                {RULE_TYPE_LABELS[type]}
              </s-option>
            ))}
          </s-select>
        </s-stack>
      </s-section>

      {values.type === 'COLLECTION_QUANTITY_TIERS' && (
        <>
          <s-section heading="Collections">
            <CollectionsField
              collections={collections}
              onChange={(next) => set('collections', next)}
              error={errors['config.collectionIds']}
            />
          </s-section>
          <s-section heading="Quantity tiers">
            <TierEditor
              type={values.type}
              tiers={values.tiers}
              onChange={(tiers) => set('tiers', tiers)}
              errors={errors}
            />
          </s-section>
        </>
      )}

      {values.type === 'CART_SUBTOTAL_TIERS' && (
        <s-section heading="Subtotal tiers">
          <TierEditor
            type={values.type}
            tiers={values.tiers}
            onChange={(tiers) => set('tiers', tiers)}
            errors={errors}
          />
        </s-section>
      )}

      {values.type === 'FREE_SHIPPING_THRESHOLD' && (
        <s-section heading="Threshold">
          <s-money-field
            label="Minimum subtotal"
            details="Orders at or above this subtotal get free shipping."
            value={values.minSubtotal}
            min={0}
            {...fieldError(errors, 'config.minSubtotal')}
            onInput={(e) => set('minSubtotal', fieldValue(e))}
          />
        </s-section>
      )}

      <s-section heading="Active dates">
        <s-stack gap="base">
          <s-date-field
            label="Start date"
            value={values.startDate}
            {...fieldError(errors, 'startsAt')}
            onChange={(e) => set('startDate', fieldValue(e))}
          />
          <s-checkbox
            label="Set an end date"
            checked={values.endDate !== ''}
            onChange={(e) => set('endDate', fieldChecked(e) ? values.startDate : '')}
          />
          {values.endDate !== '' && (
            <s-date-field
              label="End date"
              details="The rule stops at the end of this day."
              value={values.endDate}
              {...fieldError(errors, 'endsAt')}
              onChange={(e) => set('endDate', fieldValue(e))}
            />
          )}
        </s-stack>
      </s-section>

      <s-section heading="Combinations">
        <s-stack gap="small">
          <s-paragraph color="subdued">
            Which other discounts can apply to the same order as this one.
          </s-paragraph>
          <s-checkbox
            label="Product discounts"
            checked={values.combinesWith.productDiscounts}
            onChange={(e) =>
              set('combinesWith', { ...values.combinesWith, productDiscounts: fieldChecked(e) })
            }
          />
          <s-checkbox
            label="Order discounts"
            checked={values.combinesWith.orderDiscounts}
            onChange={(e) =>
              set('combinesWith', { ...values.combinesWith, orderDiscounts: fieldChecked(e) })
            }
          />
          <s-checkbox
            label="Shipping discounts"
            checked={values.combinesWith.shippingDiscounts}
            onChange={(e) =>
              set('combinesWith', { ...values.combinesWith, shippingDiscounts: fieldChecked(e) })
            }
          />
        </s-stack>
      </s-section>

      <s-section heading="Status">
        <s-switch
          label="Rule is on"
          details="Switch off to stop applying the rule without deleting it."
          checked={values.active}
          onChange={(e) => set('active', fieldChecked(e))}
        />
      </s-section>
    </s-page>
  );
}
