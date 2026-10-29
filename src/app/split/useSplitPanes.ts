import { useEffect, useSyncExternalStore } from "react";
import {
  closeSplit,
  pairLayout,
  setSplitLayout,
  splitLayout,
  splitRequest,
  subscribeSplit,
  type SplitLayout,
  type SplitRequest,
} from "./split-layout";
import {
  mapPanes,
  pane,
  paneById,
  panesOf,
  paneWithTab,
  splitPane,
  tidy,
  type Branch,
} from "./split-tree";

/** A split asked for that needs a blank tab: the layout waiting for it,
 *  its new pane (in use) without a tab yet. */
export interface Blank {
  blank: SplitLayout;
}

/**
 * The layout as the window's tabs now stand: a tab opened joins the pane in
 * use, a closed one leaves its pane, the tab in front shows in its pane,
 * and a pane left without tabs goes, one pane left ending the split. A
 * split asked for takes a tab beside the one in front into a new pane, or
 * waits for a blank one. The same object comes back when nothing changed.
 */
export function resolveSplit(
  layout: SplitLayout | null,
  request: SplitRequest | null,
  tabIds: readonly string[],
  active: string,
): SplitLayout | null | Blank {
  if (request) {
    const side = request.direction === "row" ? "right" : "bottom";
    const home = layout && paneWithTab(layout.root, active);
    // The tab beside the one in front, in its pane or the window.
    const near = home ? home.tabs : tabIds;
    const at = near.indexOf(active);
    const other = near[at + 1] ?? near[at - 1];
    if (!layout || !home) {
      if (!other) {
        const waiting = pairLayout(request.direction, active, null, 1);
        return { blank: waiting };
      }
      const paired = pairLayout(request.direction, active, other);
      const [first] = paired.root.children as [ReturnType<typeof pane>];
      first.tabs = tabIds.filter((id) => id !== other);
      first.front = active;
      return settle(paired, tabIds, active);
    }
    const added = pane(other ? [other] : [], other ?? null);
    const without = mapPanes(layout.root, (p) =>
      p.id === home.id ? { ...p, tabs: p.tabs.filter((t) => t !== other) } : p,
    );
    const root = splitPane(without, home.id, side, added) as Branch;
    const next = { root, focus: added.id };
    return other ? settle(next, tabIds, active) : { blank: next };
  }
  return layout ? settle(layout, tabIds, active) : null;
}

function settle(
  layout: SplitLayout,
  tabIds: readonly string[],
  active: string,
): SplitLayout | null {
  const open = new Set(tabIds);
  let root = mapPanes(layout.root, (p) => ({
    ...p,
    tabs: p.tabs.filter((id) => open.has(id)),
  }));
  const known = new Set(panesOf(root).flatMap((p) => p.tabs));
  const fresh = tabIds.filter((id) => !known.has(id));
  const focus = paneById(root, layout.focus)
    ? layout.focus
    : panesOf(root)[0].id;
  if (fresh.length)
    root = mapPanes(root, (p) =>
      p.id === focus ? { ...p, tabs: [...p.tabs, ...fresh] } : p,
    );
  // A pane waiting for its blank tab stays.
  const left = tidy(root, (p) => p.tabs.length > 0 || p.front === null);
  if (!left || left.kind === "pane") return null;
  const home = paneWithTab(left, active);
  const fronted = mapPanes(left, (p) => {
    const front =
      p.id === home?.id
        ? active
        : p.front && p.tabs.includes(p.front)
          ? p.front
          : (p.tabs[0] ?? null);
    return front === p.front ? p : { ...p, front };
  }) as Branch;
  const next: SplitLayout = {
    root: fronted,
    focus:
      home?.id ?? (paneById(fronted, focus) ? focus : panesOf(fronted)[0].id),
  };
  return same(next, layout) ? layout : next;
}

function same(a: SplitLayout, b: SplitLayout): boolean {
  return (
    a.focus === b.focus && JSON.stringify(a.root) === JSON.stringify(b.root)
  );
}

/** The window's split as its tabs stand, kept in step with them; null
 *  while one document shows, or a new pane waits for its tab. */
export function useSplitPanes(
  tabIds: readonly string[],
  active: string,
  addBlankTab: () => void,
): SplitLayout | null {
  const layout = useSyncExternalStore(subscribeSplit, splitLayout);
  const request = useSyncExternalStore(subscribeSplit, splitRequest);
  const resolved = resolveSplit(layout, request, tabIds, active);
  useEffect(() => {
    if (resolved && "blank" in resolved) {
      // Once per request: the layout set here takes the request away.
      if (!splitRequest()) return;
      setSplitLayout(resolved.blank);
      addBlankTab();
    } else if (resolved === null) {
      if (layout || request) closeSplit();
    } else setSplitLayout(resolved);
  }, [resolved, layout, request, addBlankTab]);
  if (!resolved || "blank" in resolved) return null;
  return panesOf(resolved.root).every((p) => p.front) ? resolved : null;
}
