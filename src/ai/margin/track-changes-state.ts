/**
 * Whether the document on screen tracks the writer's changes
 * (useOwnRevisions), for Edit › Track My Changes' check mark in the
 * app-drawn menu and the macOS menu bar. Set by the active tab's editor.
 */
let tracking = false;
const listeners = new Set<() => void>();

export function setTrackingShown(on: boolean): void {
  if (on === tracking) return;
  tracking = on;
  for (const listener of listeners) listener();
}

export function trackingShown(): boolean {
  return tracking;
}

export function subscribeTracking(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
