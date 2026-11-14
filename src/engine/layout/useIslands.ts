import { useMemo, useSyncExternalStore } from "react";
import { splitPreview, subscribeSplit, tabInUse, windowLayout } from "./store";
import { asRoot, type SplitLayout } from "./ops";
import { paneWithTab, panesOf } from "./tree";
import { usePhoneLayout } from "../controls/usePhoneLayout";

/**
 * The islands as drawn: a drag's preview while it lasts, else the window's
 * layout (store.ts) - one island, the tab in use in front, in Zen, on a
 * phone, or while a new island waits for its blank tab, that island the
 * one it is in. The stored split stays for a wider screen.
 */
export function useIslands(zen: boolean): SplitLayout {
  const layout = useSyncExternalStore(subscribeSplit, windowLayout);
  const preview = useSyncExternalStore(subscribeSplit, splitPreview);
  const active = useSyncExternalStore(subscribeSplit, tabInUse);
  const phone = usePhoneLayout();
  const whole =
    zen || phone || panesOf(layout.root).some((p) => p.front === null);
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
