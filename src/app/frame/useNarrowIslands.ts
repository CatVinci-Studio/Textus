import { useEffect, useRef, useState } from "react";
import { useIslandsNeed } from "../../engine/frame/frame-store";
import {
  foldIsland,
  unfoldIsland,
  type Folded,
} from "../../engine/layout/fold";
import {
  setSplitLayout,
  windowLayout,
  windowTabs,
} from "../../engine/layout/store";
import type { DocTab } from "../../document/doc-tabs";
import { isPanelPane } from "../islands/panel-pane";

/**
 * After the sidebar, the islands give way: a window too narrow for every
 * island at its least folds the last panel's island (the AI, Settings, a
 * plugin's page) into the island beside it, then a split of documents, and
 * puts each back once there is room again. The sidebar opened by hand into
 * too little room makes room the same way; an island opened by hand stays.
 * Returns whether the sidebar must wait: put away by the window, it comes
 * back only after every folded island has.
 */
export function useNarrowIslands(
  windowRoom: number,
  sidebar: number,
  sidebarOpen: boolean,
): boolean {
  const need = useIslandsNeed();
  const room = sidebarOpen ? windowRoom - sidebar : windowRoom;
  const folded = useRef<Folded[]>([]);
  const last = useRef({ need, windowRoom });
  // Folded islands wait to come back; one just back, until the islands'
  // need counts it again.
  const [hold, setHold] = useState(false);
  const backAt = useRef<number | null>(null);
  useEffect(() => {
    const was = last.current;
    last.current = { need, windowRoom };
    const grew = need > was.need;
    if (backAt.current !== null && need !== was.need) {
      backAt.current = null;
      setHold(folded.current.length > 0);
    }
    // The window narrowing past the sidebar puts it away first
    // (useNarrowSidebar); the islands see the room that leaves.
    const sidebarGoes =
      sidebarOpen &&
      windowRoom < was.windowRoom &&
      was.windowRoom - sidebar >= was.need &&
      room < need;
    if (!need || !room || sidebarGoes || backAt.current !== null) return;
    if (need > room && !grew) {
      const views = new Map(windowTabs<DocTab>().map((t) => [t.id, t.view]));
      const out = foldIsland(
        windowLayout(),
        (p) => isPanelPane(p, (id) => views.get(id)),
        need,
      );
      if (!out) return;
      folded.current.push(out.folded);
      setHold(true);
      setSplitLayout(out.layout);
      return;
    }
    const top = folded.current.at(-1);
    if (top && room >= top.need) {
      folded.current.pop();
      const back = unfoldIsland(windowLayout(), top);
      if (back) {
        backAt.current = need;
        setSplitLayout(back);
      } else setHold(folded.current.length > 0);
    }
  }, [need, room, windowRoom, sidebar, sidebarOpen]);
  return hold;
}
