import { tabElement } from "../engine/layout/tab-element";
import { useCallback, useEffect, useLayoutEffect } from "react";
import {
  applySourceCaret,
  captureEditorCaret,
  readSourceCaret,
  setPendingCaret,
  takePendingCaret,
} from "../editor/modes/mode-switch";
import { sourceViewAt } from "../editor/modes/source-view-registry";
import {
  setCurrentViewMode,
  viewModeFields,
  viewModeOf,
} from "../editor/modes/view-mode";
import { keepReadOnly, tabReadOnly } from "../document/read-only";
import { useSettings } from "../prefs/SettingsContext";
/** View › Mode's four. */
type ViewModeChoice = "default" | "source" | "split" | "read-only";
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
          const activeTab = tabElement();
          const source = activeTab ? sourceViewAt(activeTab) : null;
          setPendingCaret(source ? readSourceCaret(source.view) : null);
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

  // View › Mode: one of four. The rendered editor, source mode and split
  // view are every window's; read-only is the document's, in the rendered
  // editor. Choosing the one in force goes back to the default.
  const chooseViewMode = useCallback(
    (kind: ViewModeChoice) => {
      const tab = liveTabs().find((tb) => tb.id === activeTabId);
      const readOnly = !!tab && !tab.view && tabReadOnly(tab);
      const now: ViewModeChoice = readOnly
        ? "read-only"
        : mode === "rich"
          ? "default"
          : mode;
      const next = kind === now ? "default" : kind;
      const keep = next === "read-only";
      if (tab && !tab.view && readOnly !== keep) {
        if (tab.path) keepReadOnly(tab.path, keep);
        updateTab(tab.id, { readOnly: keep });
      }
      setSettings({
        viewMode: next === "source" || next === "split" ? next : "rich",
      });
    },
    [activeTabId, liveTabs, mode, setSettings, updateTab],
  );
  const toggleSourceMode = () => chooseViewMode("source");
  const toggleSplitView = () => chooseViewMode("split");

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
    // Source mode loads CodeMirror on first use, so look for its editor
    // each frame for a few seconds.
    let frames = 180;
    let frame = 0;
    const place = () => {
      const activeTab = tabElement();
      const source = activeTab ? sourceViewAt(activeTab) : null;
      if (source) applySourceCaret(source.view, caret);
      else if (--frames > 0) frame = requestAnimationFrame(place);
    };
    frame = requestAnimationFrame(place);
    return () => cancelAnimationFrame(frame);
  }, [activeSourceMode, activeTabId]);

  return { toggleSourceMode, toggleSplitView, toggleReadOnly, chooseViewMode };
}
