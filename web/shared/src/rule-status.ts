/**
 * Where a rule is in its lifecycle, as shown on the rules list.
 *
 * `inactive` (switched off by the merchant) wins over the date-based states,
 * because a switched-off rule never applies whatever its dates say.
 */
export type RuleStatus = 'active' | 'scheduled' | 'expired' | 'inactive';

export interface RuleSchedule {
  active: boolean;
  startsAt: Date | string;
  endsAt: Date | string | null;
}

export function ruleStatus(rule: RuleSchedule, now: Date = new Date()): RuleStatus {
  if (!rule.active) return 'inactive';
  if (new Date(rule.startsAt) > now) return 'scheduled';
  if (rule.endsAt !== null && new Date(rule.endsAt) <= now) return 'expired';
  return 'active';
}
