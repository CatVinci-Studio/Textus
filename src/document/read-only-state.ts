/** Whether the document in front is read only, for Settings' switch beside
 *  the View menu's. Set by the window as it computes the menu's checks. */
let readOnly = false;
const listeners = new Set<() => void>();

export function setReadOnlyShown(on: boolean): void {
  if (on === readOnly) return;
  readOnly = on;
  for (const listener of listeners) listener();
}

export function readOnlyShown(): boolean {
  return readOnly;
}

export function subscribeReadOnly(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
