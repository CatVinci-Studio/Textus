import { useSyncExternalStore } from "react";
import {
  splitLayout,
  splitPreview,
  subscribeSplit,
  type SplitLayout,
} from "./store";
import { panesOf } from "./tree";

/** The window's split as the model holds it (store.ts settles it with the
 *  tabs), or a drag's preview while it lasts; null while one document
 *  shows, or a new pane waits for its tab. */
export function useSplitPanes(): SplitLayout | null {
  const layout = useSyncExternalStore(subscribeSplit, splitLayout);
  const preview = useSyncExternalStore(subscribeSplit, splitPreview);
  if (preview) return preview;
  if (!layout) return null;
  return panesOf(layout.root).every((p) => p.front) ? layout : null;
}
