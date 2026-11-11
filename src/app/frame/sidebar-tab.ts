import { getUiState, setUiState } from "../../storage/ui-state";
import type { SidebarTabId } from "./useSidePanels";
import { DEFAULT_SIDEBAR_TAB, sidebarTabs } from "./sidebar-tabs";

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
