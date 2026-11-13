import { useLayoutEffect, useRef } from "react";
import { placeOnArrival, windowLayout } from "../../engine/layout/store";
import { panesOf, type Pane } from "../../engine/layout/tree";
import type { DocTab } from "../../document/doc-tabs";
import { isPanelPane } from "./panel-pane";
import { documentBesidePanels } from "./panel-add";

/**
 * A document that arrives in an island of pages only (the AI's, Settings')
 * - by +, Ctrl/⌘ N, File › New or the sidebar - goes beside them instead,
 * before it is drawn.
 */
export function useDocumentsApart(
  tabs: readonly DocTab[],
  isPanel: (pane: Pane) => boolean,
): void {
  const seen = useRef<Set<string> | null>(null);
  useLayoutEffect(() => {
    const before = seen.current;
    seen.current = new Set(tabs.map((tab) => tab.id));
    if (!before) return;
    const viewOf = (id: string) => tabs.find((tab) => tab.id === id)?.view;
    for (const tab of tabs) {
      if (before.has(tab.id) || tab.view) continue;
      const pane = panesOf(windowLayout().root).find((p) =>
        p.tabs.includes(tab.id),
      );
      const others = pane && {
        ...pane,
        tabs: pane.tabs.filter((id) => id !== tab.id),
      };
      if (others && isPanelPane(others, viewOf))
        placeOnArrival(tab.id, documentBesidePanels(tab.id, isPanel));
    }
  });
}
