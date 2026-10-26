import { useEffect, useSyncExternalStore } from "react";
import {
  closeSplit,
  pairLayout,
  setSplitLayout,
  splitLayout,
  splitRequest,
  subscribeSplit,
  type PaneIndex,
  type SplitLayout,
  type SplitRequest,
} from "./split-layout";

/**
 * The layout as the window's tabs now stand: a tab opened joins the pane in
 * use, a closed one leaves its pane, the tab in front shows in its pane,
 * and a pane left without tabs ends the split. "blank" when a split is
 * asked for in a window of one tab, so a blank one must open. The same
 * object comes back when nothing changed.
 */
export function resolveSplit(
  layout: SplitLayout | null,
  request: SplitRequest | null,
  tabIds: readonly string[],
  active: string,
): SplitLayout | null | "blank" {
  if (!layout) {
    if (!request) return null;
    const at = tabIds.indexOf(active);
    const other = tabIds[at + 1] ?? tabIds[at - 1];
    if (!other) return "blank";
    return settle(pairLayout(request.direction, active, other), tabIds, active);
  }
  return settle(layout, tabIds, active);
}

function settle(
  layout: SplitLayout,
  tabIds: readonly string[],
  active: string,
): SplitLayout | null {
  const open = new Set(tabIds);
  const groups = layout.groups.map((group) =>
    group.filter((id) => open.has(id)),
  ) as [string[], string[]];
  const known = new Set(groups.flat());
  for (const id of tabIds) if (!known.has(id)) groups[layout.focus].push(id);
  const waiting = layout.panes[1] === null && groups[1].length === 0;
  if (!groups[0].length || (!groups[1].length && !waiting)) return null;
  const panes = [...layout.panes] as [string, string | null];
  const at: PaneIndex | null = groups[0].includes(active)
    ? 0
    : groups[1].includes(active)
      ? 1
      : null;
  if (at !== null) panes[at] = active;
  if (!groups[0].includes(panes[0])) panes[0] = groups[0][0];
  if (!waiting && (panes[1] === null || !groups[1].includes(panes[1])))
    panes[1] = groups[1][0];
  const next: SplitLayout = {
    ...layout,
    panes,
    groups,
    focus: at ?? layout.focus,
  };
  return same(next, layout) ? layout : next;
}

function same(a: SplitLayout, b: SplitLayout): boolean {
  return (
    a.focus === b.focus &&
    a.panes[0] === b.panes[0] &&
    a.panes[1] === b.panes[1] &&
    a.groups.every(
      (group, i) =>
        group.length === b.groups[i].length &&
        group.every((id, j) => id === b.groups[i][j]),
    )
  );
}

/** The window's split as its tabs stand, kept in step with them. */
export function useSplitPanes(
  tabIds: readonly string[],
  active: string,
  addBlankTab: () => void,
): SplitLayout | null {
  const layout = useSyncExternalStore(subscribeSplit, splitLayout);
  const request = useSyncExternalStore(subscribeSplit, splitRequest);
  const resolved = resolveSplit(layout, request, tabIds, active);
  useEffect(() => {
    if (resolved === "blank") {
      // Once per request: the layout set here takes the request away.
      if (!splitRequest()) return;
      // The blank tab opens into the second pane.
      setSplitLayout(pairLayout(request?.direction ?? "row", active, null, 1));
      addBlankTab();
    } else if (resolved === null) {
      if (layout || request) closeSplit();
    } else setSplitLayout(resolved);
  }, [resolved, layout, request, active, addBlankTab]);
  const shown = resolved === "blank" ? null : resolved;
  return shown?.panes[1] ? shown : null;
}
