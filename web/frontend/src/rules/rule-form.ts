import {
  RULE_CONFIG_VERSION,
  fieldErrors,
  ruleInputSchema,
  type RuleDto,
  type RuleInput,
  type RuleType,
} from '@tierdeals/shared';

/**
 * Form state for creating or editing a rule, and its conversion to and from
 * the API's shapes.
 *
 * Inputs hold strings (what the fields emit); conversion to numbers and ISO
 * dates happens in one place, `toRuleInput`, and validation reuses the
 * server's Zod schema, so a form that passes here will not be rejected by
 * the API. Error keys are the schema's dotted paths, e.g.
 * `config.tiers.1.percentage`.
 */

export interface TierRow {
  /** Stable React key; rows can be removed from the middle. */
  key: number;
  threshold: string;
  percentage: string;
}

export interface CollectionRef {
  id: string;
  /** Null until looked up, or if the collection has been deleted. */
  title: string | null;
}

export interface RuleFormValues {
  title: string;
  type: RuleType;
  collections: CollectionRef[];
  tiers: TierRow[];
  /** Free shipping threshold. */
  minSubtotal: string;
  active: boolean;
  /** Local calendar dates as YYYY-MM-DD; `endDate` is '' for no end. */
  startDate: string;
  endDate: string;
  combinesWith: RuleInput['combinesWith'];
}

let nextTierKey = 1;

export function newTierRow(threshold = '', percentage = ''): TierRow {
  return { key: nextTierKey++, threshold, percentage };
}

/** The name of a tier's threshold in the rule config. */
export function thresholdKey(type: RuleType): 'minQuantity' | 'minSubtotal' {
  return type === 'COLLECTION_QUANTITY_TIERS' ? 'minQuantity' : 'minSubtotal';
}

export function emptyForm(
  type: RuleType = 'COLLECTION_QUANTITY_TIERS',
  today = new Date(),
): RuleFormValues {
  return {
    title: '',
    type,
    collections: [],
    tiers: [newTierRow()],
    minSubtotal: '',
    active: true,
    startDate: toDateInput(today),
    endDate: '',
    combinesWith: { productDiscounts: false, orderDiscounts: false, shippingDiscounts: false },
  };
}

/** Switching type keeps the shared fields and starts the type's own fresh. */
export function withType(values: RuleFormValues, type: RuleType): RuleFormValues {
  if (type === values.type) return values;
  return { ...values, type, collections: [], tiers: [newTierRow()], minSubtotal: '' };
}

export function formFromRule(rule: RuleDto): RuleFormValues {
  const base = {
    title: rule.title,
    type: rule.type,
    collections: [] as CollectionRef[],
    tiers: [newTierRow()],
    minSubtotal: '',
    active: rule.active,
    startDate: toDateInput(new Date(rule.startsAt)),
    endDate: rule.endsAt === null ? '' : toDateInput(new Date(rule.endsAt)),
    combinesWith: rule.combinesWith,
  };

  const config = rule.config;
  switch (config.type) {
    case 'COLLECTION_QUANTITY_TIERS':
      return {
        ...base,
        collections: config.collectionIds.map((id) => ({ id, title: null })),
        tiers: config.tiers.map((t) => newTierRow(String(t.minQuantity), String(t.percentage))),
      };
    case 'CART_SUBTOTAL_TIERS':
      return {
        ...base,
        tiers: config.tiers.map((t) => newTierRow(String(t.minSubtotal), String(t.percentage))),
      };
    case 'FREE_SHIPPING_THRESHOLD':
      return { ...base, minSubtotal: String(config.minSubtotal) };
  }
}

/**
 * Builds the API payload. Not yet validated: blank numbers become
 * `undefined` and unparseable dates are passed through, so the schema
 * reports them with its own messages.
 */
export function toRuleInput(values: RuleFormValues): unknown {
  const tiers = values.tiers.map((row) => ({
    [thresholdKey(values.type)]: toNumber(row.threshold),
    percentage: toNumber(row.percentage),
  }));

  const config =
    values.type === 'COLLECTION_QUANTITY_TIERS'
      ? {
          version: RULE_CONFIG_VERSION,
          type: values.type,
          collectionIds: values.collections.map((c) => c.id),
          tiers,
        }
      : values.type === 'CART_SUBTOTAL_TIERS'
        ? { version: RULE_CONFIG_VERSION, type: values.type, tiers }
        : {
            version: RULE_CONFIG_VERSION,
            type: values.type,
            minSubtotal: toNumber(values.minSubtotal),
          };

  return {
    title: values.title,
    config,
    active: values.active,
    startsAt: startOfDay(values.startDate),
    endsAt: values.endDate === '' ? null : endOfDay(values.endDate),
    combinesWith: values.combinesWith,
  };
}

export type FormValidation =
  { ok: true; input: RuleInput } | { ok: false; errors: Record<string, string> };

export function validateForm(values: RuleFormValues): FormValidation {
  const result = ruleInputSchema.safeParse(toRuleInput(values));
  return result.success
    ? { ok: true, input: result.data }
    : { ok: false, errors: fieldErrors(result.error.issues) };
}

function toNumber(value: string): number | undefined {
  return value.trim() === '' ? undefined : Number(value);
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

/** A Date as a local YYYY-MM-DD, the format date fields use. */
export function toDateInput(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** A rule starts at the beginning of its start day, in the merchant's time zone. */
function startOfDay(date: string): string {
  const parsed = new Date(`${date}T00:00:00`);
  return Number.isNaN(parsed.getTime()) ? date : parsed.toISOString();
}

/** A rule ends at the end of its end day, so "ends 31 Oct" includes 31 Oct. */
function endOfDay(date: string): string {
  const parsed = new Date(`${date}T23:59:59.999`);
  return Number.isNaN(parsed.getTime()) ? date : parsed.toISOString();
}
