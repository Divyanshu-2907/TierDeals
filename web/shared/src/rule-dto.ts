import type { RuleConfig, RuleType } from './rule-config.js';
import type { RuleInput } from './rule-input.js';
import type { RuleStatus } from './rule-status.js';

/** Whether a rule's Postgres row matches its Shopify discount. */
export type SyncStatus = 'SYNCED' | 'PENDING' | 'OUT_OF_SYNC';

/** A rule as the API returns it. Dates are ISO 8601 strings. */
export interface RuleDto {
  id: string;
  title: string;
  type: RuleType;
  config: RuleConfig;
  active: boolean;
  startsAt: string;
  endsAt: string | null;
  combinesWith: RuleInput['combinesWith'];
  /** Derived from `active` and the dates at the time of the request. */
  status: RuleStatus;
  sync: {
    status: SyncStatus;
    /** Why the last push to Shopify failed, in words a merchant can act on. */
    error: string | null;
    shopifyDiscountId: string | null;
    lastSyncedAt: string | null;
  };
  createdAt: string;
  updatedAt: string;
}

/** Shape of every error response from the API. */
export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    requestId?: string;
    details?: unknown;
  };
}
