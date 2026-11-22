import { useEffect, useSyncExternalStore } from "react";
import { auth, type CustomEndpointConfig } from "../platform/ipc";
import { listenToThisWindow } from "../platform/events";
import { createSubscribers } from "../utils/store";

/** The user's own endpoints, each a provider of its own in every list: the
 *  catalog's one "custom" entry stands for all of them. */

/** Whether a catalog entry is one of the user's endpoints. */
export const isCustomEntry = (entry: { auth: readonly string[] }) =>
  entry.auth.includes("custom");

/** Whether a provider id names one of the user's endpoints: the first,
 *  migrated from the single endpoint, kept "custom"; the rest "custom:…".
 *  As Rust's `is_custom_id` (auth/custom_endpoint/store.rs). */
export const isCustomId = (id: string) =>
  id === "custom" || id.startsWith("custom:");

/** What an endpoint is called in the lists: its name, else its host, so
 *  two unnamed relays still read apart. */
export function endpointLabel(
  endpoint: Pick<CustomEndpointConfig, "name" | "base_url">,
): string {
  const name = endpoint.name.trim();
  if (name) return name;
  try {
    return new URL(endpoint.base_url.trim()).host;
  } catch {
    return endpoint.base_url.trim();
  }
}

/** `catalog` with its custom entry replaced by one entry per endpoint, in
 *  the order they were added. An endpoint's id is its provider id. */
export function withCustomEndpoints<
  E extends { id: string; label: string; auth: readonly string[] },
>(catalog: readonly E[], endpoints: readonly CustomEndpointConfig[]): E[] {
  return catalog.flatMap((entry) =>
    isCustomEntry(entry)
      ? endpoints.map((e) => ({ ...entry, id: e.id, label: endpointLabel(e) }))
      : [entry],
  );
}

// One copy for the window, asked for once and again after each change.
let endpoints: readonly CustomEndpointConfig[] = [];
let asked = false;
/** Whether the list has been read (or failed to be): until then an id it
 *  lacks may still be in it. */
let read = false;
const subscribers = createSubscribers();

/** Reads the saved endpoints again, for every list showing them. */
export function refreshCustomEndpoints(): Promise<void> {
  asked = true;
  return Promise.resolve()
    .then(() => auth.customEndpointsStatus())
    .then((list) => {
      endpoints = list;
    })
    .catch(() => {})
    .finally(() => {
      read = true;
      subscribers.publish();
    });
}

/** Sent to every window once an endpoint is saved or removed, so a renamed
 *  one reads anew everywhere. As `CHANGED_EVENT` in Rust's
 *  auth/custom_endpoint.rs. */
const CHANGED_EVENT = "custom-endpoints-changed";
let following = false;

function subscribe(listener: () => void) {
  if (!asked) void refreshCustomEndpoints();
  if (!following) {
    following = true;
    void listenToThisWindow(CHANGED_EVENT, () => void refreshCustomEndpoints());
  }
  return subscribers.subscribe(listener);
}

/** The saved endpoints; empty until read. */
export function useCustomEndpoints(): readonly CustomEndpointConfig[] {
  return useSyncExternalStore(subscribe, () => endpoints);
}

/** Whether the saved endpoints have been read. */
export function useCustomEndpointsRead(): boolean {
  return useSyncExternalStore(subscribe, () => read);
}

let followed: string | null = null;

/** Reads the endpoints again once the chosen models name another set of
 *  them: another window saved or removed one, and its settings came here. */
export function useFollowEndpointChoices(chosen: Record<string, string>) {
  const key = Object.keys(chosen).filter(isCustomId).sort().join(" ");
  useEffect(() => {
    if (key === followed) return;
    const first = followed === null;
    followed = key;
    if (!first) void refreshCustomEndpoints();
  }, [key]);
}
