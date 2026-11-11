import { useMemo, useSyncExternalStore } from "react";
import {
  splitPreview,
  subscribeSplit,
  tabInUse,
  windowLayout,
} from "./store";
import { asRoot, type SplitLayout } from "./ops";
import { paneWithTab, panesOf } from "./tree";

/**
 * The islands as drawn: a drag's preview while it lasts, else the window's
 * layout (store.ts) - one island, the tab in use in front, in Zen or while
 * a new island waits for its blank tab, that island the one it is in.
 */
export function useIslands(zen: boolean): SplitLayout {
  const layout = useSyncExternalStore(subscribeSplit, windowLayout);
  const preview = useSyncExternalStore(subscribeSplit, splitPreview);
  const active = useSyncExternalStore(subscribeSplit, tabInUse);
  const whole = zen || panesOf(layout.root).some((p) => p.front === null);
  const one = useMemo(() => {
    if (!whole) return null;
    const panes = panesOf(layout.root);
    const home = paneWithTab(layout.root, active) ?? panesOf(layout.root)[0];
    const only = {
      ...home,
      tabs: panes.flatMap((p) => p.tabs),
      front: active || home.front,
    };
    return { root: asRoot(only), focus: only.id };
  }, [whole, layout, active]);
  return preview ?? one ?? layout;
}
