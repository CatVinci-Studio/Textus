import { useCallback, useEffect, useLayoutEffect } from "react";
import {
  applyTextareaCaret,
  captureEditorCaret,
  readTextareaCaret,
  setPendingCaret,
  takePendingCaret,
} from "../editor/modes/mode-switch";
import {
  setCurrentViewMode,
  viewModeFields,
  viewModeOf,
} from "../editor/modes/view-mode";
import { keepReadOnly, tabReadOnly } from "../document/read-only";
import { useSettings } from "../prefs/SettingsContext";
import type { ViewMode } from "../prefs/settings-types";
import type { TabState } from "./tabs/useTabState";

/** The rich editor, plain source mode and split view, one for every tab of
 *  every window (Settings' viewMode): switching in one window switches them
 *  all, the caret carried across in the tab in front; and a tab's read-only
 *  mode. */
export function useSourceModes(tabState: TabState) {
  const { tabs, activeTabId, liveTabs, updateTab } = tabState;
  const { settings, setSettings } = useSettings();
  const mode = settings.viewMode;

  // Before the tabs below, which a new one copies.
  useLayoutEffect(() => setCurrentViewMode(mode), [mode]);

  // Every tab of this window to the view all documents are in.
  useEffect(() => {
    for (const tab of liveTabs()) {
      // A plugin's tab has no Markdown to show as source.
      if (tab.view || viewModeOf(tab) === mode) continue;
      const front = tab.id === activeTabId;
      if (mode === "rich") {
        // The view being left records its caret; the one entered places it.
        if (front) {
          const textarea = document.querySelector<HTMLTextAreaElement>(
            '[data-active-tab="true"] textarea.source-view',
          );
          setPendingCaret(textarea ? readTextareaCaret(textarea) : null);
        }
        // Remount the rich editor so it picks up the raw text.
        updateTab(tab.id, {
          ...viewModeFields(mode),
          reloadKey: tab.reloadKey + 1,
        });
      } else {
        // Live content: entering source mode unmounts the editor and any
        // edit its debounce still holds.
        if (front && !tab.sourceMode)
          setPendingCaret(captureEditorCaret(tab.content));
        updateTab(tab.id, { content: tab.content, ...viewModeFields(mode) });
      }
    }
  }, [mode, tabs, activeTabId, liveTabs, updateTab]);

  const switchTo = useCallback(
    (next: ViewMode) => setSettings({ viewMode: next }),
    [setSettings],
  );
  // Source mode from the rich editor or split view (whose preview goes);
  // back to the rich editor from source mode.
  const toggleSourceMode = useCallback(
    () => switchTo(mode === "source" ? "rich" : "source"),
    [mode, switchTo],
  );
  const toggleSplitView = useCallback(
    () => switchTo(mode === "split" ? "rich" : "split"),
    [mode, switchTo],
  );

  // View › Read Only, or a tab's own menu: kept by the file's path.
  const toggleReadOnly = useCallback(
    (id: string = activeTabId) => {
      const tab = liveTabs().find((tb) => tb.id === id);
      if (!tab || tab.view) return;
      const next = !tabReadOnly(tab);
      if (tab.path) keepReadOnly(tab.path, next);
      updateTab(tab.id, { readOnly: next });
    },
    [activeTabId, updateTab, liveTabs],
  );

  // The source view just mounted: put the caret the editor left there.
  const activeSourceMode =
    tabs.find((tb) => tb.id === activeTabId)?.sourceMode ?? false;
  useEffect(() => {
    if (!activeSourceMode) return;
    const caret = takePendingCaret();
    if (!caret) return;
    // Split View loads on first use, so look for its textarea each frame,
    // for a second.
    let frames = 60;
    let frame = 0;
    const place = () => {
      const textarea = document.querySelector<HTMLTextAreaElement>(
        '[data-active-tab="true"] textarea.source-view',
      );
      if (textarea) applyTextareaCaret(textarea, caret);
      else if (--frames > 0) frame = requestAnimationFrame(place);
    };
    frame = requestAnimationFrame(place);
    return () => cancelAnimationFrame(frame);
  }, [activeSourceMode, activeTabId]);

  return { toggleSourceMode, toggleSplitView, toggleReadOnly };
}
