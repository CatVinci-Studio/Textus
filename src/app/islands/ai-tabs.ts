/**
 * Where each AI tab draws its conversation: the tab's own element, which
 * the window hands the conversation to while that tab's conversation is
 * the live one. Kept here so the tab (drawn among the documents) and the
 * window (which picks the live one) needn't pass it through React.
 */
const mounts = new Map<string, HTMLElement>();
const listeners = new Set<() => void>();
let version = 0;

export function setAiMount(tabId: string, el: HTMLElement | null): void {
  if ((mounts.get(tabId) ?? null) === el) return;
  if (el) mounts.set(tabId, el);
  else mounts.delete(tabId);
  version++;
  for (const listener of listeners) listener();
}

export function aiMount(tabId: string): HTMLElement | null {
  return mounts.get(tabId) ?? null;
}

export function aiMountsVersion(): number {
  return version;
}

export function onAiMounts(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** The conversation not yet sent: a tab of its own until it is. */
export const DRAFT = "draft";

/** The AI button pressed while the AI is shown: the window decides what
 *  that does with its AI tabs (useAiTabs). */
export const AI_PRESS_EVENT = "textus:ai-press";
