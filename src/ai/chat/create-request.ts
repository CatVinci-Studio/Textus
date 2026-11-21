import { createSubscribers } from "../../utils/store";
/**
 * A request for Settings › Extensions › Create from anywhere in the window -
 * a plugin's "Edit with AI", a reply card's "Fix with AI". Create works in
 * its tab, not in the document's AI panel: an open tab takes the request
 * itself, so its conversation carries on; otherwise Settings opens there and
 * the tab takes it as it mounts.
 */

/** What Create makes; each is the name of the built-in skill that makes it. */
export type CreateKind = "plugin" | "theme" | "skill";

export interface CreateRequest {
  text: string;
  kind: CreateKind;
  /** For a theme: an installed one the workshop opens on. */
  start?: string;
}

/** Asks the window to open Settings at Extensions › Create. */
const createAsks = createSubscribers();
export const onCreateAsked = createAsks.subscribe;

let pending: CreateRequest | null = null;
const subscribers = createSubscribers();

export function requestCreate(
  text: string,
  kind: CreateKind = "plugin",
  start?: string,
): void {
  pending = start ? { text, kind, start } : { text, kind };
  subscribers.publish();
  // No tab open took it.
  if (pending) createAsks.publish();
}

/** The theme workshop on `start` (the theme in use without one), in front:
 *  asked from a theme's card, away from Create. */
export function requestWorkshop(start?: string): void {
  requestCreate("", "theme", start);
  // An open Create tab took it: it comes to the front.
  if (!pending) createAsks.publish();
}

/** The request waiting, once: whoever takes it handles it. */
export function takeCreateRequest(): CreateRequest | null {
  const request = pending;
  pending = null;
  return request;
}

/** For the open Create tab: `take` runs on each request. */
export const onCreateRequest = subscribers.subscribe;
