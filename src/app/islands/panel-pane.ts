import type { Pane } from "../../engine/layout/tree";
import { windowTabs } from "../../engine/layout/store";
import type { DocTab } from "../../document/doc-tabs";

/** A panel's island: it holds pages only (the AI, Settings, a plugin's),
 *  no document. */
export function isPanelPane(
  pane: Pane,
  viewOf: (tabId: string) => { kind: string } | null | undefined,
): boolean {
  return (
    pane.tabs.length > 0 && pane.tabs.every((id) => viewOf(id)?.kind === "page")
  );
}

/** isPanelPane over the window's tabs as they are when asked. */
export const isWindowPanel = (pane: Pane): boolean =>
  isPanelPane(
    pane,
    (id) => windowTabs<DocTab>().find((tab) => tab.id === id)?.view,
  );
