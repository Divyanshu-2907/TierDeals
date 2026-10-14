import { RULE_TYPE_LABELS, type RuleDto } from '@tierdeals/shared';
import { useState } from 'react';
import { useNavigate } from 'react-router';

import { useDeleteRule, useRetrySync, useRules, useSetRuleActive } from '../api/hooks';
import { RuleStatusBadge, SyncStatusBadge } from '../rules/badges';
import { fieldChecked } from '../ui/events';
import { showError } from '../ui/toast';

const DELETE_MODAL_ID = 'delete-rule-modal';

export function RulesListPage() {
  const navigate = useNavigate();
  const rules = useRules();
  const setActive = useSetRuleActive();
  const retrySync = useRetrySync();
  const deleteRule = useDeleteRule();
  const [pendingDelete, setPendingDelete] = useState<RuleDto | null>(null);

  async function toggle(rule: RuleDto, active: boolean) {
    try {
      const updated = await setActive.mutateAsync({ id: rule.id, active });
      if (updated.sync.status === 'OUT_OF_SYNC') {
        showError(`Saved, but Shopify was not updated: ${updated.sync.error ?? ''}`);
      } else {
        shopify.toast.show(active ? 'Rule switched on' : 'Rule switched off');
      }
    } catch (error) {
      showError(error);
    }
  }

  async function retry(rule: RuleDto) {
    try {
      const updated = await retrySync.mutateAsync(rule.id);
      if (updated.sync.status === 'SYNCED') {
        shopify.toast.show('Rule synced with Shopify');
      } else {
        showError(updated.sync.error ?? 'Shopify was not updated.');
      }
    } catch (error) {
      showError(error);
    }
  }

  async function confirmDelete() {
    if (!pendingDelete) return;
    try {
      await deleteRule.mutateAsync(pendingDelete.id);
      shopify.toast.show('Rule deleted');
    } catch (error) {
      showError(error);
    } finally {
      setPendingDelete(null);
    }
  }

  const outOfSync = rules.data?.filter((rule) => rule.sync.status === 'OUT_OF_SYNC') ?? [];

  return (
    <s-page heading="Discount rules">
      <s-button slot="primary-action" variant="primary" onClick={() => void navigate('/rules/new')}>
        Create rule
      </s-button>

      {outOfSync.length > 0 && (
        <s-banner
          tone="warning"
          heading={
            outOfSync.length === 1
              ? '1 rule does not match its Shopify discount'
              : `${outOfSync.length} rules do not match their Shopify discounts`
          }
        >
          Checkout keeps applying the last version Shopify accepted. Each rule below shows why its
          last sync failed; fix the cause if needed, then retry.
        </s-banner>
      )}

      {rules.isPending && (
        <s-section>
          <s-stack alignItems="center" padding="large">
            <s-spinner accessibilityLabel="Loading rules" />
          </s-stack>
        </s-section>
      )}

      {rules.isError && (
        <s-banner tone="critical" heading="Rules could not be loaded">
          {rules.error.message}
          <s-button slot="secondary-actions" onClick={() => void rules.refetch()}>
            Try again
          </s-button>
        </s-banner>
      )}

      {rules.data?.length === 0 && (
        <s-section>
          <s-empty-state heading="Create your first discount rule">
            <s-paragraph slot="subheading">
              Reward bigger carts with quantity tiers, subtotal tiers or free shipping. Rules run at
              checkout through a Shopify Function.
            </s-paragraph>
            <s-button
              slot="primary-action"
              variant="primary"
              onClick={() => void navigate('/rules/new')}
            >
              Create rule
            </s-button>
          </s-empty-state>
        </s-section>
      )}

      {rules.data !== undefined && rules.data.length > 0 && (
        <s-section padding="none" accessibilityLabel="Discount rules">
          <s-table>
            <s-table-header-row>
              <s-table-header listSlot="primary">Rule</s-table-header>
              <s-table-header listSlot="labeled">Type</s-table-header>
              <s-table-header listSlot="inline">Status</s-table-header>
              <s-table-header listSlot="labeled">Shopify</s-table-header>
              <s-table-header listSlot="labeled">On</s-table-header>
              <s-table-header>
                <s-text accessibilityVisibility="exclusive">Actions</s-text>
              </s-table-header>
            </s-table-header-row>
            <s-table-body>
              {rules.data.map((rule) => (
                <s-table-row key={rule.id}>
                  <s-table-cell>
                    <s-link onClick={() => void navigate(`/rules/${rule.id}`)}>{rule.title}</s-link>
                  </s-table-cell>
                  <s-table-cell>{RULE_TYPE_LABELS[rule.type]}</s-table-cell>
                  <s-table-cell>
                    <RuleStatusBadge status={rule.status} />
                  </s-table-cell>
                  <s-table-cell>
                    <s-stack gap="small-200">
                      <SyncStatusBadge status={rule.sync.status} />
                      {rule.sync.status === 'OUT_OF_SYNC' && (
                        <>
                          {rule.sync.error !== null && (
                            <s-text color="subdued">{rule.sync.error}</s-text>
                          )}
                          <s-button
                            variant="tertiary"
                            loading={retrySync.isPending && retrySync.variables === rule.id}
                            onClick={() => void retry(rule)}
                          >
                            Retry sync
                          </s-button>
                        </>
                      )}
                    </s-stack>
                  </s-table-cell>
                  <s-table-cell>
                    <s-switch
                      accessibilityLabel={`${rule.active ? 'Switch off' : 'Switch on'} ${rule.title}`}
                      checked={rule.active}
                      disabled={setActive.isPending && setActive.variables.id === rule.id}
                      onChange={(e) => void toggle(rule, fieldChecked(e))}
                    />
                  </s-table-cell>
                  <s-table-cell>
                    <s-button
                      variant="tertiary"
                      tone="critical"
                      icon="delete"
                      accessibilityLabel={`Delete ${rule.title}`}
                      commandFor={DELETE_MODAL_ID}
                      command="--show"
                      onClick={() => setPendingDelete(rule)}
                    />
                  </s-table-cell>
                </s-table-row>
              ))}
            </s-table-body>
          </s-table>
        </s-section>
      )}

      <s-modal id={DELETE_MODAL_ID} heading="Delete this rule?">
        <s-paragraph>
          “{pendingDelete?.title}” and its Shopify discount will be deleted. Orders that already
          used it are not affected.
        </s-paragraph>
        <s-button
          slot="primary-action"
          variant="primary"
          tone="critical"
          loading={deleteRule.isPending}
          commandFor={DELETE_MODAL_ID}
          command="--hide"
          onClick={() => void confirmDelete()}
        >
          Delete rule
        </s-button>
        <s-button slot="secondary-actions" commandFor={DELETE_MODAL_ID} command="--hide">
          Cancel
        </s-button>
      </s-modal>
    </s-page>
  );
}
