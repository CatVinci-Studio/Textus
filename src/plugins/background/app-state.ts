import {
  schedule as scheduleIpc,
  type AppState,
} from "../../platform/ipc-schedule";
import { listenToThisWindow, unlistenAll } from "../../platform/events";
import { isMobileApp } from "../../platform/capabilities";
import { emitPluginEvent } from "../app-bridge";

/**
 * Whether a Textus window is in front ("active"), open behind others
 * ("inactive") or none is ("background"), as Rust tells every window
 * (src-tauri/src/schedule/app_state.rs); on a phone, whether the app is on
 * screen or in the background. Plugins read it as textus.app.state.
 */

let current: AppState = "active";

export function currentAppState(): AppState {
  return current;
}

/** The state now and as it changes, told to plugins. */
export function watchAppState(): () => void {
  if (isMobileApp) return watchVisibility();
  void scheduleIpc
    .appState()
    .then(set)
    .catch(() => {});
  return unlistenAll(
    listenToThisWindow<AppState>("app-state", (e) => set(e.payload)),
  );
}

function watchVisibility(): () => void {
  const follow = () =>
    set(document.visibilityState === "hidden" ? "background" : "active");
  follow();
  document.addEventListener("visibilitychange", follow);
  return () => document.removeEventListener("visibilitychange", follow);
}

/** A page with no window of the user's: the hidden background host. */
export function setAppState(state: AppState): void {
  set(state);
}

function set(state: AppState) {
  if (state === current) return;
  current = state;
  emitPluginEvent("appState", state);
}
