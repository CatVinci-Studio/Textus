import { useSyncExternalStore } from "react";
import { splitPreview, subscribeSplit } from "../../engine/layout/store";
import { panesOf } from "../../engine/layout/tree";
import { useSplitPanes } from "../../engine/layout/useSplitPanes";

/** Whether the documents' tabs are shown in the bar's row: a split's top
 *  panes always have theirs, one pane when shown, none in Zen. A drag's
 *  preview (one island spelt out, say) keeps its rows of tabs. */
export function useTabsInBar(zen: boolean, showTabBar: boolean): boolean {
  const split = useSplitPanes();
  const previewing = useSyncExternalStore(
    subscribeSplit,
    () => splitPreview() !== null,
  );
  const docsSplit = !!split && panesOf(split.root).length > 1;
  return !zen && (docsSplit || showTabBar || previewing);
}
