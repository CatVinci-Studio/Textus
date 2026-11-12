import { windowIpc } from "../platform/ipc";

/**
 * A window's session, the one record of it the next launch brings back:
 * its documents, how its islands were laid out, the folder it had open -
 * kept by the native side per window (commands/session.rs).
 */
export interface WindowSession {
  paths: string[];
  layout?: unknown;
  folder?: string | null;
}

let taken: Promise<WindowSession | null> | null = null;

/** Set once a window has started: its sessionStorage outlives a reload of
 *  the page, not the window. */
const STARTED = "textus-window-started";

function reloaded(): boolean {
  try {
    const again = sessionStorage.getItem(STARTED) === "1";
    sessionStorage.setItem(STARTED, "1");
    return again;
  } catch {
    return false;
  }
}

/** What this window was opened with, asked once: a session's window, or
 *  files handed over (only their paths) - or, reloaded, the session it
 *  last told, so the reload keeps its folder and islands. */
export function takeWindowSession(): Promise<WindowSession | null> {
  taken ??= (
    reloaded()
      ? windowIpc.currentWindowSession()
      : windowIpc.takePendingWindow()
  )
    .then((window) => (window ? (window as WindowSession) : null))
    .catch(() => null);
  return taken;
}
