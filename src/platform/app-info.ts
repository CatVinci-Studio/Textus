import { getVersion } from "@tauri-apps/api/app";
import { relaunch } from "@tauri-apps/plugin-process";
import { inBrowser } from "./runtime";

export type { Update } from "@tauri-apps/plugin-updater";

/** The app's version; empty in the browser. */
export function appVersion(): Promise<string> {
  return inBrowser ? Promise.resolve("") : getVersion();
}

/** Starts the app again (after an update); reloads the page in the browser. */
export function relaunchApp(): Promise<void> {
  if (!inBrowser) return relaunch();
  location.reload();
  return Promise.resolve();
}
