import { z } from 'zod';

import { ruleConfigSchema } from './rule-config.js';

/**
 * What the admin UI sends to create or update a rule. The rule type is not a
 * separate field: it is `config.type`, so the two can never disagree.
 */
export const ruleInputSchema = z
  .object({
    title: z.string().trim().min(1, 'Enter a title.').max(255, 'Use at most 255 characters.'),
    config: ruleConfigSchema,
    active: z.boolean(),
    startsAt: z.iso.datetime({ offset: true, error: 'Enter a valid start date.' }),
    endsAt: z.iso.datetime({ offset: true, error: 'Enter a valid end date.' }).nullable(),
    combinesWith: z.object({
      productDiscounts: z.boolean(),
      orderDiscounts: z.boolean(),
      shippingDiscounts: z.boolean(),
    }),
  })
  .refine((rule) => rule.endsAt === null || Date.parse(rule.endsAt) > Date.parse(rule.startsAt), {
    message: 'The end date must be after the start date.',
    path: ['endsAt'],
  });

export type RuleInput = z.infer<typeof ruleInputSchema>;

/** Body of `PATCH /api/rules/:id/active`. */
export const ruleActiveInputSchema = z.object({ active: z.boolean() });

export type RuleActiveInput = z.infer<typeof ruleActiveInputSchema>;

/**
 * Flattens Zod issues into `{ "config.tiers.1.percentage": "message" }`, the
 * shape the API returns in `error.details.fields` and the form reads to show
 * errors next to the right input. The first issue per field wins.
 */
export function fieldErrors(issues: readonly z.core.$ZodIssue[]): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const issue of issues) {
    const key = issue.path.map(String).join('.');
    errors[key] ??= issue.message;
  }
  return errors;
}
