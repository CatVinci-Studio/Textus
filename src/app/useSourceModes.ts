import { useCallback, useEffect } from "react";
import {
  applyTextareaCaret,
  captureEditorCaret,
  readTextareaCaret,
  setPendingCaret,
  takePendingCaret,
} from "../editor/modes/mode-switch";
import type { DocTab } from "../document/doc-tabs";
import type { TabState } from "./useTabState";

/** Switching the active tab between the rich editor, plain source mode and
 *  split view, with the caret carried across each switch. */
export function useSourceModes(tabState: TabState) {
  const { tabs, activeTabId, liveTabs, updateTab } = tabState;

  // Back to the rich editor, from plain source mode or split view alike.
  const leaveSourceMode = useCallback(
    (tab: DocTab) => {
      // Keep the user's place across the switch (editor/modes/mode-switch.ts): the
      // view being left records its caret, the one being entered places it.
      const textarea = document.querySelector<HTMLTextAreaElement>(
        '[data-active-tab="true"] textarea.source-view',
      );
      setPendingCaret(textarea ? readTextareaCaret(textarea) : null);
      // Force the WYSIWYG editor to remount so it picks up whatever was
      // typed as raw text.
      updateTab(tab.id, {
        sourceMode: false,
        splitView: false,
        reloadKey: tab.reloadKey + 1,
      });
    },
    [updateTab],
  );

  const toggleSourceMode = useCallback(() => {
    // Live content: entering source mode unmounts the editor, and with it
    // any edit its debounce still holds.
    const tab = liveTabs().find((tb) => tb.id === activeTabId);
    // A plugin's tab has no Markdown to show as source.
    if (!tab || tab.view) return;
    if (tab.sourceMode && tab.splitView) {
      // Split view shows Source Mode as off - the menu check and the switch
      // in Settings both say so - so turning it on from there means plain
      // source mode: the preview goes, the source stays.
      updateTab(activeTabId, { splitView: false });
    } else if (tab.sourceMode) {
      leaveSourceMode(tab);
    } else {
      setPendingCaret(captureEditorCaret(tab.content));
      updateTab(activeTabId, { content: tab.content, sourceMode: true });
    }
  }, [activeTabId, updateTab, liveTabs, leaveSourceMode]);

  // Split view = source mode with a live preview beside it. From the rich
  // editor it enters source mode the same way (caret carried across); from
  // split view it returns to the rich editor; from plain source mode it
  // just adds the preview.
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

  // The source view just mounted: put the caret the editor left there.
  const activeSourceMode =
    tabs.find((tb) => tb.id === activeTabId)?.sourceMode ?? false;
  useEffect(() => {
    if (!activeSourceMode) return;
    const caret = takePendingCaret();
    if (!caret) return;
    requestAnimationFrame(() => {
      const textarea = document.querySelector<HTMLTextAreaElement>(
        '[data-active-tab="true"] textarea.source-view',
      );
      if (textarea) applyTextareaCaret(textarea, caret);
    });
  }, [activeSourceMode, activeTabId]);

  return { toggleSourceMode, toggleSplitView };
}
