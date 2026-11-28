import { useLayoutEffect, useRef } from "react";
import { getUiState, setUiState } from "../../storage/ui-state";
import { enter } from "../../engine/controls/moves";
import type { SidebarTabId } from "./useSidePanels";
import { DEFAULT_SIDEBAR_TAB, railTabs, sidebarTabs } from "./sidebar-tabs";

/** The sidebar tab last shown, or Files when nothing usable is stored. */
export function storedSidebarTab(): SidebarTabId {
  const stored = getUiState("sidebarTab");
  return (
    sidebarTabs().find((tab) => tab.id === stored)?.id ?? DEFAULT_SIDEBAR_TAB
  );
}

export function storeSidebarTab(tab: SidebarTabId): void {
  setUiState("sidebarTab", tab);
}

/** Where a tab sits on the rail, top to bottom: the foot's after the rest. */
function railPlace(id: string): number {
  const tabs = railTabs();
  const order = [
    ...tabs.filter((tab) => !tab.railFoot),
    ...tabs.filter((tab) => tab.railFoot),
  ].map((tab) => tab.id);
  const at = order.indexOf(id);
  return at < 0 ? order.length : at;
}

/** The panel's box, for the switch from one panel to another to show which
 *  way it went: the new one comes in a short way from its side of the rail
 *  (a later tab from the end, an earlier one from the start) as it fades
 *  in, the old one gone at once. Not as the sidebar opens: its own slide
 *  carries the panel then. Only the box moves, so focus and the panel's
 *  scroll are left as the panel sets them. */
export function usePanelSwitchMotion(shownId: string, open: boolean) {
  const body = useRef<HTMLDivElement>(null);
  const last = useRef({ id: shownId, open });
  const running = useRef<Animation | null>(null);
  // Before paint: the new panel's first frame is already its entrance's.
  useLayoutEffect(() => {
    const was = last.current;
    last.current = { id: shownId, open };
    if (!open || !was.open || was.id === shownId || !body.current) return;
    running.current?.cancel();
    running.current = enter(body.current, {
      from: railPlace(shownId) > railPlace(was.id) ? "end" : "start",
      distance: "lg",
      duration: "--dur-fast",
    });
  }, [shownId, open]);
  return body;
}
