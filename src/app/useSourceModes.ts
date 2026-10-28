import { useCallback, useEffect } from "react";
import {
  applyTextareaCaret,
  captureEditorCaret,
  readTextareaCaret,
  setPendingCaret,
  takePendingCaret,
} from "../editor/modes/mode-switch";
import type { DocTab } from "../document/doc-tabs";
import { keepReadOnly, tabReadOnly } from "../document/read-only";
import type { TabState } from "./tabs/useTabState";

/** Switching the active tab between the rich editor, plain source mode and
 *  split view, with the caret carried across each switch; and a tab's
 *  read-only mode. */
export function useSourceModes(tabState: TabState) {
  const { tabs, activeTabId, liveTabs, updateTab } = tabState;

  // Back to the rich editor, from plain source mode or split view alike.
  const leaveSourceMode = useCallback(
    (tab: DocTab) => {
      // The view being left records its caret; the one entered places it.
      const textarea = document.querySelector<HTMLTextAreaElement>(
        '[data-active-tab="true"] textarea.source-view',
      );
      setPendingCaret(textarea ? readTextareaCaret(textarea) : null);
      // Remount the rich editor so it picks up the raw text.
      updateTab(tab.id, {
        sourceMode: false,
        splitView: false,
        reloadKey: tab.reloadKey + 1,
      });
    },
    [updateTab],
  );

  const toggleSourceMode = useCallback(() => {
    // Live content: entering source mode unmounts the editor and any edit
    // its debounce still holds.
    const tab = liveTabs().find((tb) => tb.id === activeTabId);
    // A plugin's tab has no Markdown to show as source.
    if (!tab || tab.view) return;
    if (tab.sourceMode && tab.splitView) {
      // Split view shows Source Mode as off, so turning it on means plain
      // source mode: the preview goes.
      updateTab(activeTabId, { splitView: false });
    } else if (tab.sourceMode) {
      leaveSourceMode(tab);
    } else {
      setPendingCaret(captureEditorCaret(tab.content));
      updateTab(activeTabId, { content: tab.content, sourceMode: true });
    }
  }, [activeTabId, updateTab, liveTabs, leaveSourceMode]);

  // Split view = source mode with a live preview. From the rich editor it
  // enters source mode; from split view it returns; from plain source mode
  // it adds the preview.
  const toggleSplitView = useCallback(() => {
    const tab = liveTabs().find((tb) => tb.id === activeTabId);
    // A plugin's tab has no Markdown to show as source.
    if (!tab || tab.view) return;
    if (tab.sourceMode && tab.splitView) {
      leaveSourceMode(tab);
    } else if (tab.sourceMode) {
      updateTab(activeTabId, { splitView: true });
    } else {
      setPendingCaret(captureEditorCaret(tab.content));
      updateTab(activeTabId, {
        content: tab.content,
        sourceMode: true,
        splitView: true,
      });
    }
  }, [activeTabId, updateTab, liveTabs, leaveSourceMode]);

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
