import { useEffect, useRef, useState } from "react";
import { useIslandsNeed } from "../../engine/frame/frame-store";
import { foldPanel, unfoldPanel, type Folded } from "../../engine/layout/fold";
import {
  setSplitLayout,
  windowLayout,
  windowTabs,
} from "../../engine/layout/store";
import type { DocTab } from "../../document/doc-tabs";
import { isPanelPane } from "../islands/panel-pane";

/**
 * After the sidebar, the panels give way: a window too narrow for every
 * island at its least folds the last panel's island (the AI, Settings, a
 * plugin's page) into the island beside it, and puts it back once there is
 * room again. Documents' islands never fold. A panel opened by hand into
 * too little room stays, as the sidebar does. Returns whether the sidebar
 * must wait: it comes back only after every folded panel has.
 */
export function useNarrowIslands(room: number, sidebarOpen: boolean): boolean {
  const need = useIslandsNeed();
  const folded = useRef<Folded[]>([]);
  const lastNeed = useRef(need);
  // Folded panels wait to come back; one just back, until the islands'
  // need counts it again.
  const [hold, setHold] = useState(false);
  const backAt = useRef<number | null>(null);
  useEffect(() => {
    const grew = need > lastNeed.current;
    const changed = need !== lastNeed.current;
    lastNeed.current = need;
    if (backAt.current !== null && changed) {
      backAt.current = null;
      setHold(folded.current.length > 0);
    }
    if (!need || !room || sidebarOpen || backAt.current !== null) return;
    if (need > room && !grew) {
      const views = new Map(windowTabs<DocTab>().map((t) => [t.id, t.view]));
      const out = foldPanel(
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
    const last = folded.current.at(-1);
    if (last && room >= last.need) {
      folded.current.pop();
      const back = unfoldPanel(windowLayout(), last);
      if (back) {
        backAt.current = need;
        setSplitLayout(back);
      } else setHold(folded.current.length > 0);
    }
  }, [need, room, sidebarOpen]);
  return hold;
}
