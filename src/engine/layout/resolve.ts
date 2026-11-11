import {
  asRoot,
  type Arrival,
  type SplitLayout,
  type SplitRequest,
} from "./ops";
import {
  mapPanes,
  pane,
  paneById,
  panesOf,
  paneWithTab,
  splitPane,
  tidy,
  keepsItself,
} from "./tree";

/**
 * The layout as the window's tabs now stand (the store settles it on every
 * change): pure, so it is tested alone.
 */

/** A split asked for that needs a blank tab: the layout waiting for it,
 *  its new pane (in use) without a tab yet. */
interface Blank {
  blank: SplitLayout;
}

/**
 * The layout as the window's tabs now stand: a tab opened joins the pane in
 * use, a closed one leaves its pane, the tab in front shows in its pane,
 * and a pane left without tabs goes. A split asked for takes a tab beside
 * the one in front into a new pane, or waits for a blank one. The same object comes back when nothing changed.
 */
export function resolveSplit(
  layout: SplitLayout,
  request: SplitRequest | null,
  tabIds: readonly string[],
  active: string,
  arrival: (tabId: string) => Arrival | undefined,
): SplitLayout | Blank {
  // A tab arriving with its place asked for takes it, not the pane in use.
  if (!request)
    for (const id of tabIds) {
      const place = arrival(id);
      if (place && !paneWithTab(layout.root, id))
        layout = place(layout) ?? layout;
    }
  if (request) {
    const side = request.direction === "row" ? "right" : "bottom";
    const home =
      paneWithTab(layout.root, active) ??
      paneById(layout.root, layout.focus) ??
      panesOf(layout.root)[0];
    // The tab beside the one in front, in its pane.
    const at = home.tabs.indexOf(active);
    const other = home.tabs[at + 1] ?? home.tabs[at - 1];
    const added = pane(other ? [other] : [], other ?? null);
    const without = mapPanes(layout.root, (p) =>
      p.id === home.id ? { ...p, tabs: p.tabs.filter((t) => t !== other) } : p,
    );
    const next = {
      root: asRoot(splitPane(without, home.id, side, added)),
      focus: added.id,
    };
    return other ? settle(next, tabIds, active) : { blank: next };
  }
  return settle(layout, tabIds, active);
}

function settle(
  layout: SplitLayout,
  tabIds: readonly string[],
  active: string,
): SplitLayout {
  const open = new Set(tabIds);
  let root = mapPanes(layout.root, (p) => ({
    ...p,
    tabs: p.tabs.filter((id) => open.has(id)),
  }));
  const known = new Set(panesOf(root).flatMap((p) => p.tabs));
  const fresh = tabIds.filter((id) => !known.has(id));
  // Opened tabs join the pane in use, or the first.
  const focus = paneById(root, layout.focus)
    ? layout.focus
    : panesOf(root)[0].id;
  if (fresh.length)
    root = mapPanes(root, (p) =>
      p.id === focus ? { ...p, tabs: [...p.tabs, ...fresh] } : p,
    );
  // A pane waiting for its blank tab stays; with no tab at all, the pane
  // in use waits for the window's first.
  const left =
    tidy(root, (p) => keepsItself(p) || p.front === null) ??
    paneById(root, focus)!;
  const home = paneWithTab(left, active);
  const fronted = asRoot(
    mapPanes(left, (p) => {
      const front =
        p.id === home?.id
          ? active
          : p.front && p.tabs.includes(p.front)
            ? p.front
            : (p.tabs[0] ?? null);
      return front === p.front ? p : { ...p, front };
    }),
  );
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
