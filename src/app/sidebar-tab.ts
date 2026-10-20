import { getUiState, setUiState } from "../storage/ui-state";
import type { PanelMode } from "./useSidePanels";

const SIDEBAR_TABS: readonly PanelMode[] = ["tree", "outline", "clipboard"];

/** The sidebar tab last shown (ui-state's sidebarTab), or Files when
 *  nothing usable is stored - a tab an older or newer build wrote that
 *  this one doesn't have. */
export function storedSidebarTab(): PanelMode {
  const stored = getUiState("sidebarTab");
  return SIDEBAR_TABS.find((tab) => tab === stored) ?? "tree";
}

export function storeSidebarTab(tab: PanelMode): void {
  setUiState("sidebarTab", tab);
}
