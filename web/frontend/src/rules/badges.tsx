import type { RuleStatus, SyncStatus } from '@tierdeals/shared';

const STATUS: Record<RuleStatus, { label: string; tone: 'success' | 'info' | 'neutral' }> = {
  active: { label: 'Active', tone: 'success' },
  scheduled: { label: 'Scheduled', tone: 'info' },
  expired: { label: 'Expired', tone: 'neutral' },
  inactive: { label: 'Off', tone: 'neutral' },
};

export function RuleStatusBadge({ status }: { status: RuleStatus }) {
  const { label, tone } = STATUS[status];
  return <s-badge tone={tone}>{label}</s-badge>;
}

const SYNC: Record<SyncStatus, { label: string; tone: 'success' | 'caution' | 'critical' }> = {
  SYNCED: { label: 'In sync', tone: 'success' },
  PENDING: { label: 'Syncing', tone: 'caution' },
  OUT_OF_SYNC: { label: 'Out of sync', tone: 'critical' },
};

/** Whether Shopify's discount matches the rule. */
export function SyncStatusBadge({ status }: { status: SyncStatus }) {
  const { label, tone } = SYNC[status];
  return <s-badge tone={tone}>{label}</s-badge>;
}
