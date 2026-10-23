import { useEffect } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { canUseWindows } from "../platform/capabilities";
import { session } from "../platform/ipc";
import type { DocTab } from "../document/doc-tabs";

/** The OS title names the document too: it is what the taskbar, Alt+Tab
 *  and window lists show, where every window read "Textus" before. */
export function useWindowTitle(activeTitle: string): void {
  useEffect(() => {
    if (!canUseWindows) return;
    void getCurrentWindow()
      .setTitle(`${activeTitle} - Textus`)
      .catch(() => {});
  }, [activeTitle]);
}

/**
 * Reports this window's on-disk tab paths to Rust so a relaunch (an app
 * update, a crash, or just quitting and reopening) can restore what was
 * open - see commands/session.rs. Untitled/unsaved tabs have no path and
 * are simply skipped; keyed on the joined path list (not `tabs` itself) so
 * content edits don't spam the round trip.
 */
export function useSessionPaths(tabs: DocTab[]): void {
  // A plugin's tab of a file (a PDF) reopens through its plugin.
  const pathOf = (tab: DocTab) => tab.path ?? tab.view?.resource ?? null;
  const sessionPathsKey = tabs.map((tab) => pathOf(tab) ?? "").join("\n");
  useEffect(() => {
    if (!canUseWindows) return;
    void session.updateSessionPaths(
      sessionPathsKey.split("\n").filter((path) => !!path),
    );
  }, [sessionPathsKey]);
}
