/**
 * What the browser has in place of Tauri's IPC globals. `convertFileSrc` (for
 * an image at a disk path) gives a URL that loads nothing instead of a
 * TypeError; any `invoke()` gets a rejection it can catch, never a request.
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
