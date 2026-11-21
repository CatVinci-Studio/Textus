import { keepInList, uiList } from "../storage/ui-state";
import type { DocTab } from "./doc-tabs";

/** Whether the tab is pinned: as set on it, else as its file was left. */
export function tabPinned(tab: DocTab): boolean {
  if (tab.pinned !== undefined) return tab.pinned;
  return tab.path !== null && uiList("pinnedPaths").includes(tab.path);
}

/** Remembers whether the file at `path` is pinned, for when it opens
 *  again. */
export function keepPinned(path: string, on: boolean): void {
  keepInList("pinnedPaths", path, on);
}

/** `ids` with the pinned ones first, each part in its order. */
export function pinnedFirst(
  ids: readonly string[],
  pinned: (id: string) => boolean,
): string[] {
  return [...ids.filter(pinned), ...ids.filter((id) => !pinned(id))];
}

/** Where a tab dragged to `index` lands: a pinned one among the pinned,
 *  another after them. */
export function placeAmongPinned(
  index: number,
  isPinned: boolean,
  pinnedCount: number,
): number {
  return isPinned
    ? Math.min(index, Math.max(0, pinnedCount - 1))
    : Math.max(index, pinnedCount);
}
