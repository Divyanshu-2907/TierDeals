import { render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { TierEditor } from '../src/components/TierEditor';
import { newTierRow, type TierRow } from '../src/rules/rule-form';

function setup(tiers: TierRow[], errors: Record<string, string> = {}) {
  const onChange = vi.fn<(tiers: TierRow[]) => void>();
  const { container } = render(
    <TierEditor
      type="COLLECTION_QUANTITY_TIERS"
      tiers={tiers}
      onChange={onChange}
      errors={errors}
    />,
  );
  const buttons = [...container.querySelectorAll('s-button')];
  return {
    container,
    onChange,
    addButton: buttons.find((b) => b.textContent === 'Add tier')!,
    removeButtons: buttons.filter((b) =>
      b.getAttribute('accessibilitylabel')?.startsWith('Remove'),
    ),
  };
}

const click = (element: Element) =>
  element.dispatchEvent(new MouseEvent('click', { bubbles: true }));

describe('TierEditor', () => {
  it('renders a threshold and a percentage field per tier', () => {
    const { container } = setup([newTierRow('2', '10'), newTierRow('3', '15')]);

    expect(container.querySelectorAll('s-number-field')).toHaveLength(4);
  });

  it('adds an empty tier', () => {
    const tiers = [newTierRow('2', '10')];
    const { addButton, onChange } = setup(tiers);

    click(addButton);

    const next = onChange.mock.calls[0]![0];
    expect(next).toHaveLength(2);
    expect(next[1]).toMatchObject({ threshold: '', percentage: '' });
  });

  it('removes the chosen tier and keeps the rest in order', () => {
    const tiers = [newTierRow('2', '10'), newTierRow('3', '15'), newTierRow('5', '25')];
    const { removeButtons, onChange } = setup(tiers);

    click(removeButtons[1]!);

    expect(onChange).toHaveBeenCalledWith([tiers[0], tiers[2]]);
  });

  it('does not allow removing the last tier', () => {
    const { removeButtons } = setup([newTierRow('2', '10')]);

    expect(removeButtons[0]!.hasAttribute('disabled')).toBe(true);
  });

  it('stops offering new tiers at the limit of 10', () => {
    const tiers = Array.from({ length: 10 }, (_, i) => newTierRow(String(i + 1), String(i + 1)));

    expect(setup(tiers).addButton.hasAttribute('disabled')).toBe(true);
  });

  it('shows errors on the matching row', () => {
    const { container } = setup([newTierRow('2', '10'), newTierRow('2', '15')], {
      'config.tiers.1.minQuantity': 'Another tier already uses this threshold.',
    });

    const fields = container.querySelectorAll('s-number-field');
    expect(fields[0]!.getAttribute('error')).toBeNull();
    expect(fields[2]!.getAttribute('error')).toBe('Another tier already uses this threshold.');
  });
});
