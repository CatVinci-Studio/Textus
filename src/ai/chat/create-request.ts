/**
 * A request for Settings › Extensions › Create from anywhere in the window -
 * a plugin's "Edit with AI", a reply card's "Fix with AI". Create works in
 * its tab, not in the document's AI panel: an open tab takes the request
 * itself, so its conversation carries on; otherwise Settings opens there and
 * the tab takes it as it mounts.
 */

/** What Create makes; each is the name of the built-in skill that makes it. */
export type CreateKind = "plugin" | "theme" | "skill";

interface CreateRequest {
  text: string;
  kind: CreateKind;
}

/** Asks the window to open Settings at Extensions › Create. */
export const OPEN_CREATE_EVENT = "textus-open-create";

let pending: CreateRequest | null = null;
const takers = new Set<() => void>();

export function requestCreate(text: string, kind: CreateKind = "plugin"): void {
  pending = { text, kind };
  for (const take of takers) take();
  // No tab open took it.
  if (pending) window.dispatchEvent(new CustomEvent(OPEN_CREATE_EVENT));
}

/** The request waiting, once: whoever takes it handles it. */
export function takeCreateRequest(): CreateRequest | null {
  const request = pending;
  pending = null;
  return request;
}

/** For the open Create tab: `take` runs on each request. */
export function onCreateRequest(take: () => void): () => void {
  takers.add(take);
  return () => takers.delete(take);
}
