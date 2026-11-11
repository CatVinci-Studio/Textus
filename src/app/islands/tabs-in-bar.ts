import { useSyncExternalStore } from "react";
import {
  splitLayout,
  splitPreview,
  subscribeSplit,
} from "../../engine/layout/store";
import { panesOf } from "../../engine/layout/tree";

/** Whether the split or a drag's preview shows more than one island (a
 *  preview always keeps its rows of tabs). Read as a yes or no, so a
 *  divider dragged doesn't draw again what reads it. */
function splitShown(): boolean {
  if (splitPreview()) return true;
  const layout = splitLayout();
  if (!layout) return false;
  const panes = panesOf(layout.root);
  return panes.length > 1 && panes.every((p) => p.front);
}

/** Whether the documents' tabs are shown in the bar's row: a split's top
 *  panes always have theirs, one pane when shown, none in Zen. */
export function useTabsInBar(zen: boolean, showTabBar: boolean): boolean {
  const split = useSyncExternalStore(subscribeSplit, splitShown);
  return !zen && (split || showTabBar);
}
