/** How many plugins' floating views are open: all the startup code knows of
 *  them, so the rest loads only once one opens. */
let count = 0;
const listeners = new Set<() => void>();

export function floatingCount(): number {
  return count;
}

export function setFloatingCount(next: number) {
  if (next === count) return;
  count = next;
  for (const listener of listeners) listener();
}

export function subscribeFloatingCount(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
