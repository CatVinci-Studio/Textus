import {
  emitTo,
  listen,
  type EventCallback,
  type UnlistenFn,
} from "@tauri-apps/api/event";
import { thisWindow } from "./this-window";
import { inBrowser } from "./runtime";

/** `listen` for this window, its target read per call: the dev shim
 *  installs the label at startup. */
function listenHere<T>(
  event: string,
  handler: EventCallback<T>,
  target: (
    label: string,
  ) => NonNullable<Parameters<typeof listen>[2]>["target"],
): Promise<UnlistenFn> {
  if (inBrowser) return Promise.resolve(() => {});
  return listen<T>(event, handler, { target: target(thisWindow().label) });
}

/**
 * Listen to an event addressed to this window only. Never the bare
 * `listen()`: its Any target also receives what Rust's `emit_to` meant
 * for another window, so with two windows each event fired in both.
 */
export function listenToThisWindow<T>(
  event: string,
  handler: EventCallback<T>,
): Promise<UnlistenFn> {
  return listenHere(event, handler, (label) => label);
}

/** Listen to an event Tauri addresses to this window's webview, such as a
 *  file drop (`tauri://drag-drop`), which listenToThisWindow never hears. */
export function listenToThisWebview<T>(
  event: string,
  handler: EventCallback<T>,
): Promise<UnlistenFn> {
  return listenHere(event, handler, (label) => ({ kind: "Webview", label }));
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
