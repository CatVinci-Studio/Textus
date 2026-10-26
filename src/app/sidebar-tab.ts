import { getUiState, setUiState } from "../storage/ui-state";
import type { PanelMode } from "./useSidePanels";
import { DEFAULT_SIDEBAR_TAB, sidebarTabs } from "./sidebar-tabs";

/** The sidebar tab last shown, or Files when nothing usable is stored. */
export function storedSidebarTab(): PanelMode {
  const stored = getUiState("sidebarTab");
  return (
    sidebarTabs().find((tab) => tab.id === stored)?.id ?? DEFAULT_SIDEBAR_TAB
  );
}

export function storeSidebarTab(tab: PanelMode): void {
  setUiState("sidebarTab", tab);
}
