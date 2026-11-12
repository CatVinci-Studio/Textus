import { moveTab, splitOff, type Arrival } from "../../engine/layout/ops";
import { panesOf, type Pane } from "../../engine/layout/tree";
import { ifRoom } from "../../engine/layout/store";

/** Where a document made from a panel's island (the AI's, Settings') goes:
 *  the first island with documents, else one of its own at the window's
 *  left - never in among the pages. */
export function documentBesidePanels(
  tabId: string,
  isPanel: (pane: Pane) => boolean,
): Arrival {
  return (now) => {
    const home = panesOf(now.root).find(
      (p) => !p.tabs.includes(tabId) && !isPanel(p),
    );
    return home
      ? moveTab(now, tabId, home.id)
      : (ifRoom(splitOff(now, tabId, null, "left")) ?? now);
  };
}
