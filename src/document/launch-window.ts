import { windowIpc } from "../platform/ipc";

/**
 * A window's session, the one record of it the next launch brings back:
 * its documents, how its islands were laid out, the folder it had open -
 * kept by the native side per window (commands/session.rs).
 */
interface WindowSession {
  paths: string[];
  layout?: unknown;
  folder?: string | null;
  /** Documents handed over as it opened: in front. */
  opened?: string[];
}

let taken: Promise<WindowSession | null> | null = null;

/** Set once a window has started: its sessionStorage outlives a reload of
 *  the page, not the window. */
const STARTED = "textus-window-started";

let wasReloaded: boolean | undefined;

/** Whether this page is a reload of the window's, not its first start:
 *  read once, as reading marks the window started. */
export function pageReloaded(): boolean {
  if (wasReloaded !== undefined) return wasReloaded;
  try {
    wasReloaded = sessionStorage.getItem(STARTED) === "1";
    sessionStorage.setItem(STARTED, "1");
  } catch {
    wasReloaded = false;
  }
  return wasReloaded;
}

/** What this window was opened with, asked once: a session's window, or
 *  files handed over (only their paths) - or, reloaded, the session it
 *  last told, so the reload keeps its folder and islands. */
export function takeWindowSession(): Promise<WindowSession | null> {
  taken ??= (
    pageReloaded()
      ? windowIpc.currentWindowSession()
      : windowIpc.takePendingWindow()
  )
    .then((window) => (window ? (window as WindowSession) : null))
    .catch(() => null);
  return taken;
}
