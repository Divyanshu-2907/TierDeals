/** The imperative API of a Polaris `<s-modal>`. */
interface Overlay {
  showOverlay(): void;
  hideOverlay(): void;
}

function modal(id: string): Overlay | null {
  return document.getElementById(id) as unknown as Overlay | null;
}

/**
 * Opens a Polaris modal from code, for when a button's declarative
 * `command="--show"` cannot be used (e.g. it depends on an async result).
 */
export function showModal(id: string): void {
  modal(id)?.showOverlay();
}

export function hideModal(id: string): void {
  modal(id)?.hideOverlay();
}
