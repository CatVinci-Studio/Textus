import { convertFileSrc } from "@tauri-apps/api/core";
import { inBrowser } from "./runtime";

/** A URL the page can load a file on disk from. A browser can't show one,
 *  so there it is a URL that loads nothing. */
export function fileSrc(path: string): string {
  return inBrowser ? "about:blank" : convertFileSrc(path);
}

/** Where a plugin's own files are served (plugins/scheme.rs), ending in "/";
 *  null where nothing serves them (the browser, the dev browser's shim). */
export function pluginFilesBase(): string | null {
  return inBrowser ? null : convertFileSrc("", "textus-plugin") || null;
}
