import {
  listen,
  type EventCallback,
  type UnlistenFn,
} from "@tauri-apps/api/event";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";

/**
 * Listen to a Tauri event addressed to THIS window only.
 *
 * Use this, never the bare `listen()` from @tauri-apps/api/event: that one
 * registers with target `{ kind: "Any" }`, and an Any-target listener is a
 * deliberate catch-all on the Rust side - it receives every emit app-wide,
 * INCLUDING ones a `emit_to(EventTarget::webview_window(label), ...)` meant
 * for one specific window (tauri's event/listener.rs: `match_any_or_filter`
 * short-circuits to true before the target filter ever runs). With two
 * windows open, every window-scoped event therefore fired in all of them -
 * a file opened in tab mode landed in each window, a menu command ran once
 * per window, a dragged tab was received by windows it was never dropped on.
 *
 * Passing a label narrows the listener to `AnyLabel`, which catches
 * `emit_to` from Rust and `emitTo` from another window's JS by that label,
 * and nothing addressed elsewhere - nor what Tauri itself addresses to the
 * webview (listenToThisWebview). Every event in this app is window-addressed - Rust
 * only ever calls `emit_to`, never the broadcasting `emit` - so there is
 * nothing left that legitimately wants the catch-all.
 */
export function listenToThisWindow<T>(
  event: string,
  handler: EventCallback<T>,
): Promise<UnlistenFn> {
  return listen<T>(event, handler, {
    // Read per call, not once at module scope: the dev browser shim
    // (tauri-shim.ts) installs the metadata this reads at startup.
    target: getCurrentWebviewWindow().label,
  });
}

/**
 * Listen to an event Tauri addresses to this window's webview, such as a
 * file drop (`tauri://drag-drop`). listenToThisWindow's label never hears
 * those: a drop went unnoticed on every platform.
 */
export function listenToThisWebview<T>(
  event: string,
  handler: EventCallback<T>,
): Promise<UnlistenFn> {
  return listen<T>(event, handler, {
    target: { kind: "Webview", label: getCurrentWebviewWindow().label },
  });
}

/**
 * Teardown for a batch of Tauri subscriptions - `return unlistenAll(...)`
 * from the effect that opened them.
 *
 * Every subscribe call in the Tauri API (`listen`, `onCloseRequested`,
 * `onMoved`, ...) resolves its unlisten function asynchronously, so each one
 * otherwise costs a `void sub.then((f) => f())` line in a hand-written
 * cleanup - fifteen of them in useMenuBridge alone. Worth collapsing because
 * the failure mode is silent: miss a line and that listener outlives the
 * unmount, then fires twice over once the effect re-runs.
 */
export function unlistenAll(...subs: Promise<UnlistenFn>[]): () => void {
  return () => {
    for (const sub of subs) void sub.then((f) => f());
  };
}
