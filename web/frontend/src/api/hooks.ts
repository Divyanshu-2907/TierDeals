import type { RuleDto, RuleInput } from '@tierdeals/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { apiFetch } from './client';

const RULES_KEY = ['rules'] as const;

export function useRules() {
  return useQuery({
    queryKey: RULES_KEY,
    queryFn: async () => (await apiFetch<{ rules: RuleDto[] }>('/api/rules')).rules,
  });
}

export function useRule(id: string | undefined) {
  return useQuery({
    queryKey: [...RULES_KEY, id],
    queryFn: async () => (await apiFetch<{ rule: RuleDto }>(`/api/rules/${id}`)).rule,
    enabled: id !== undefined,
  });
}

export function useShop() {
  return useQuery({
    queryKey: ['shop'],
    queryFn: () => apiFetch<{ shop: string; currencyCode: string }>('/api/shop'),
    staleTime: Infinity,
  });
}

/** Titles for collection GIDs; IDs missing from the result were deleted. */
export function useCollections(ids: readonly string[]) {
  return useQuery({
    queryKey: ['collections', [...ids].sort()],
    queryFn: async () =>
      (
        await apiFetch<{ collections: { id: string; title: string }[] }>(
          `/api/collections?ids=${encodeURIComponent(ids.join(','))}`,
        )
      ).collections,
    enabled: ids.length > 0,
  });
}

/**
 * Wraps a rule mutation so the cached list and the rule itself are updated
 * with the server's answer, which carries the new sync status.
 */
function useRuleMutation<TVariables>(mutationFn: (variables: TVariables) => Promise<RuleDto>) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn,
    onSuccess: (rule) => {
      queryClient.setQueryData([...RULES_KEY, rule.id], rule);
      return queryClient.invalidateQueries({ queryKey: RULES_KEY, exact: true });
    },
  });
}

export function useCreateRule() {
  return useRuleMutation(
    async (input: RuleInput) =>
      (await apiFetch<{ rule: RuleDto }>('/api/rules', { method: 'POST', body: input })).rule,
  );
}

export function useUpdateRule(id: string) {
  return useRuleMutation(
    async (input: RuleInput) =>
      (await apiFetch<{ rule: RuleDto }>(`/api/rules/${id}`, { method: 'PUT', body: input })).rule,
  );
}

export function useSetRuleActive() {
  return useRuleMutation(
    async ({ id, active }: { id: string; active: boolean }) =>
      (
        await apiFetch<{ rule: RuleDto }>(`/api/rules/${id}/active`, {
          method: 'PATCH',
          body: { active },
        })
      ).rule,
  );
}

export function useRetrySync() {
  return useRuleMutation(
    async (id: string) =>
      (await apiFetch<{ rule: RuleDto }>(`/api/rules/${id}/sync`, { method: 'POST' })).rule,
  );
}

export function useDeleteRule() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiFetch<void>(`/api/rules/${id}`, { method: 'DELETE' }),
    // Refresh even on failure: a refused delete marks the rule out of sync.
    onSettled: () => queryClient.invalidateQueries({ queryKey: RULES_KEY }),
  });
}
