import { MAX_COLLECTIONS } from '@tierdeals/shared';

import type { CollectionRef } from '../rules/rule-form';

interface CollectionsFieldProps {
  collections: CollectionRef[];
  onChange: (collections: CollectionRef[]) => void;
  error: string | undefined;
}

/**
 * The collections a quantity rule counts items from, chosen with Shopify's
 * own resource picker. Units from any of them count toward the same tiers.
 */
export function CollectionsField({ collections, onChange, error }: CollectionsFieldProps) {
  async function browse() {
    const selection = await shopify.resourcePicker({
      type: 'collection',
      multiple: MAX_COLLECTIONS,
      selectionIds: collections.map(({ id }) => ({ id })),
    });
    // Undefined means the merchant closed the picker without choosing.
    if (selection === undefined) return;
    onChange(selection.map(({ id, title }) => ({ id, title })));
  }

  return (
    <s-stack gap="base">
      {collections.length > 0 && (
        <s-stack direction="inline" gap="small-200">
          {collections.map((collection) => (
            <s-chip
              key={collection.id}
              removable
              accessibilityLabel={`Remove ${collection.title ?? 'collection'}`}
              onRemove={() => onChange(collections.filter((c) => c.id !== collection.id))}
            >
              {collection.title ?? 'Deleted collection'}
            </s-chip>
          ))}
        </s-stack>
      )}

      <s-stack direction="inline" gap="base" alignItems="center">
        <s-button icon="collection" onClick={() => void browse()}>
          {collections.length === 0 ? 'Choose collections' : 'Change collections'}
        </s-button>
        {error !== undefined && <s-text tone="critical">{error}</s-text>}
      </s-stack>
    </s-stack>
  );
}
