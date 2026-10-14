import { render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

/**
 * The UI relies on React 19 wiring `onInput`, `onChange` and `onClick` on
 * Polaris custom elements to the matching native DOM events (React 18 did not
 * for custom elements). The real components load from Shopify's CDN, so here
 * the elements are bare, which is enough to test React's side of the contract.
 */
describe('React event props on Polaris custom elements', () => {
  it('receive the native input, change and click events', () => {
    const onInput = vi.fn();
    const onChange = vi.fn();
    const onClick = vi.fn();

    const { container } = render(
      <>
        <s-text-field label="Title" onInput={onInput} onChange={onChange} />
        <s-button onClick={onClick}>Save</s-button>
      </>,
    );

    const field = container.querySelector('s-text-field')!;
    field.dispatchEvent(new Event('input', { bubbles: true }));
    field.dispatchEvent(new Event('change', { bubbles: true }));
    container.querySelector('s-button')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    expect(onInput).toHaveBeenCalledOnce();
    expect(onChange).toHaveBeenCalledOnce();
    expect(onClick).toHaveBeenCalledOnce();
  });

  it('set values as element properties once the element is defined, so controlled fields work', () => {
    // In the admin, polaris-1.js defines the elements before React renders.
    // React 19 then assigns props that the element exposes as properties.
    class FakeTextField extends HTMLElement {
      value = '';
      disabled = false;
    }
    customElements.define('s-text-field-probe', FakeTextField);

    const { container } = render(
      // @ts-expect-error -- a stand-in tag, deliberately not in Polaris's types
      <s-text-field-probe value="Summer sale" disabled />,
    );
    const field = container.querySelector('s-text-field-probe') as FakeTextField;

    expect(field.value).toBe('Summer sale');
    expect(field.disabled).toBe(true);
    expect(field.hasAttribute('value')).toBe(false);
  });
});
