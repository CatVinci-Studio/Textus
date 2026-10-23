import { useEffect, useRef, useSyncExternalStore } from "react";
import {
  closeSplit,
  setSplitLayout,
  splitLayout,
  splitRequest,
  subscribeSplit,
  type SplitLayout,
  type SplitRequest,
} from "./split-layout";

/**
 * The layout as the window's tabs now stand: a split asked for, paired
 * with the tab after the one in front (or before it); a tab brought to the
 * front from the tab bar shown in the pane it was chosen from, the one in
 * front until then (`focused`, 0 or 1); a pane's tab closed, one document
 * again. "blank" when the window has one tab: a blank one is opened to
 * take the second pane.
 */
export function resolveSplit(
  layout: SplitLayout | null,
  request: SplitRequest | null,
  tabIds: readonly string[],
  active: string,
  focused: 0 | 1,
): SplitLayout | null | "blank" {
  if (!layout) {
    if (!request) return null;
    const at = tabIds.indexOf(active);
    const other = tabIds[at + 1] ?? tabIds[at - 1];
    if (!other) return "blank";
    return { direction: request.direction, panes: [active, other], ratio: 0.5 };
  }
  const [first, second] = layout.panes;
  if (!tabIds.includes(first)) return null;
  if (second === null) {
    // Waiting for the blank tab: it comes to the front.
    return active === first ? layout : { ...layout, panes: [first, active] };
  }
  if (!tabIds.includes(second)) return null;
  if (active === first || active === second) return layout;
  const panes: [string, string] =
    focused === 0 ? [active, second] : [first, active];
  return { ...layout, panes };
}

/** The window's split as its tabs stand, kept in step with them. */
export function useSplitPanes(
  tabIds: readonly string[],
  active: string,
  addBlankTab: () => void,
): SplitLayout | null {
  const layout = useSyncExternalStore(subscribeSplit, splitLayout);
  const request = useSyncExternalStore(subscribeSplit, splitRequest);
  // The pane the tab in front was last shown in.
  const focused = useRef<0 | 1>(0);
  const resolved = resolveSplit(
    layout,
    request,
    tabIds,
    active,
    focused.current,
  );
  const shown = resolved === "blank" ? null : resolved;
  if (shown) focused.current = shown.panes[1] === active ? 1 : 0;
  useEffect(() => {
    if (resolved === "blank") {
      // Once per request: the layout set here takes the request away.
      if (!splitRequest()) return;
      setSplitLayout({
        direction: request?.direction ?? "row",
        panes: [active, null],
        ratio: 0.5,
      });
      addBlankTab();
    } else if (resolved === null) {
      if (layout || request) closeSplit();
    } else setSplitLayout(resolved);
  }, [resolved, layout, request, active, addBlankTab]);
  return shown?.panes[1] ? shown : null;
}
