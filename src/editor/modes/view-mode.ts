import { getUiState, setUiState } from "../../storage/ui-state";

/** A tab's view: the rich editor, source mode, or split view (source mode
 *  with a preview). */
export interface ViewModeFields {
  sourceMode: boolean;
  splitView?: boolean;
}

/** The view a new document opens in: the one last switched to. */
export function lastViewMode(): ViewModeFields {
  const mode = getUiState("viewMode");
  if (mode === "split") return { sourceMode: true, splitView: true };
  if (mode === "source") return { sourceMode: true, splitView: false };
  return { sourceMode: false, splitView: false };
}

export function rememberViewMode({ sourceMode, splitView }: ViewModeFields) {
  setUiState("viewMode", !sourceMode ? "rich" : splitView ? "split" : "source");
}
