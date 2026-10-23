/**
 * What the browser has in place of Tauri's IPC globals. The playground
 * leaves out everything that saves or asks the backend (images, AI,
 * settings files), so the editor core reaches for the backend in one place
 * only: an image whose src is an absolute path on disk, which it hands to
 * `convertFileSrc` (image-plugin.ts's resolveImageSrc - the raw-HTML <img>
 * preview uses it too). A browser can't show a file from disk, so that
 * becomes a URL that loads nothing instead of a TypeError.
 *
 * Anything else that still calls `invoke()` gets a rejection it can catch,
 * never a request. Not the dev shim (src/dev/tauri-shim.ts): that one
 * pretends commands succeed, for testing the app in a browser.
 */
export function installNativeStandIn(): void {
  const w = window as Window & { __TAURI_INTERNALS__?: unknown };
  if (w.__TAURI_INTERNALS__) return;
  w.__TAURI_INTERNALS__ = {
    invoke: (command: string) =>
      Promise.reject(new Error(`${command}: not available in the browser`)),
    convertFileSrc: () => "about:blank",
    transformCallback: () => 0,
    unregisterCallback: () => {},
  };
}
