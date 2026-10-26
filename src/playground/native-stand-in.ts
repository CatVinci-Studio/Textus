/**
 * A backstop for anything that still calls Tauri's `invoke()` directly in
 * the browser: a rejection it can catch, never a request. The platform
 * modules already use their browser stand-ins here.
 */
export function installNativeStandIn(): void {
  const w = window as Window & { __TAURI_INTERNALS__?: unknown };
  if (w.__TAURI_INTERNALS__) return;
  w.__TAURI_INTERNALS__ = {
    invoke: (command: string) =>
      Promise.reject(new Error(`${command}: not available in the browser`)),
    transformCallback: () => 0,
    unregisterCallback: () => {},
  };
}
