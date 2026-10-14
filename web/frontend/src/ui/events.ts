/**
 * Polaris field events are native DOM events (React 19 attaches them to the
 * custom element directly), so the value is read from the element itself.
 */

/** The current value of the Polaris field that fired `event`. */
export function fieldValue(event: Event): string {
  const target = event.currentTarget as { value?: unknown } | null;
  return typeof target?.value === 'string' ? target.value : '';
}

/** Whether the Polaris checkbox or switch that fired `event` is checked. */
export function fieldChecked(event: Event): boolean {
  const target = event.currentTarget as { checked?: unknown } | null;
  return target?.checked === true;
}
