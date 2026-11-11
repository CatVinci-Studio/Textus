/**
 * A gray hint on the empty line the caret is on: the tour's next thing to
 * type in its practice tab, or "type / to insert" where the user turned
 * that on. Read by each editor's placeholder plugin as it draws.
 */
let tour: { tabId: string; text: string } | null = null;
const listeners = new Set<() => void>();

/** The tour's hint for its practice tab, or null to take it away. */
export function setTourLineHint(hint: { tabId: string; text: string } | null) {
  if (tour?.tabId === hint?.tabId && tour?.text === hint?.text) return;
  tour = hint;
  for (const listener of listeners) listener();
}

/** The tour's hint for the editor drawn in `dom`, if it is the practice tab's. */
export function tourLineHint(dom: HTMLElement): string | null {
  if (!tour) return null;
  const tabId = dom.closest<HTMLElement>("[data-tab-id]")?.dataset.tabId;
  return tabId === tour.tabId ? tour.text : null;
}

/** Calls `changed` as the tour's hint changes; returns the stop. */
export function onTourLineHint(changed: () => void): () => void {
  listeners.add(changed);
  return () => listeners.delete(changed);
}
