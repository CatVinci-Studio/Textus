import { useSyncExternalStore } from "react";

/** The width the window's islands need at the least (their minimums, the
 *  gaps and insets), as the islands' area last solved it: what the docks
 *  beside them leave room for. */
let need = 0;
const listeners = new Set<() => void>();

export function setIslandsNeed(next: number): void {
  if (Math.abs(next - need) < 0.5) return;
  need = next;
  for (const listener of listeners) listener();
}

export function useIslandsNeed(): number {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => need,
  );
}
