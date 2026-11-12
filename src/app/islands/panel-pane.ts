import type { Pane } from "../../engine/layout/tree";

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
