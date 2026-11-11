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

/** What this window was opened with, asked once: a session's window, or
 *  files handed over (only their paths). */
export function takeWindowSession(): Promise<WindowSession | null> {
  taken ??= windowIpc
    .takePendingWindow()
    .then((window) => (window ? (window as WindowSession) : null))
    .catch(() => null);
  return taken;
}
