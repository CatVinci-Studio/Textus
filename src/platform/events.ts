import {
  emitTo,
  listen,
  type EventCallback,
  type UnlistenFn,
} from "@tauri-apps/api/event";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { inBrowser } from "./runtime";

export type { EventCallback, UnlistenFn };

/**
 * Listen to an event addressed to this window only. Never the bare
 * `listen()`: its Any target also receives what Rust's `emit_to` meant
 * for another window, so with two windows each event fired in both.
 */
export function listenToThisWindow<T>(
  event: string,
  handler: EventCallback<T>,
): Promise<UnlistenFn> {
  if (inBrowser) return Promise.resolve(() => {});
  // Read per call: the dev shim installs the label at startup.
  return listen<T>(event, handler, {
    target: getCurrentWebviewWindow().label,
  });
}

/** Sends `event` to one window: a label, or a target such as
 *  `{ kind: "WebviewWindow", label }`. */
export function emitToWindow(
  target: Parameters<typeof emitTo>[0],
  event: string,
  payload?: unknown,
): Promise<void> {
  return inBrowser ? Promise.resolve() : emitTo(target, event, payload);
}

/** Teardown for a batch of subscriptions, each of which resolves its
 *  unlisten function later: `return unlistenAll(...)` from the effect. */
export function unlistenAll(...subs: Promise<UnlistenFn>[]): () => void {
  return () => {
    for (const sub of subs) void sub.then((f) => f());
  };
}
