import type { ViewMode } from "../../prefs/settings-types";

/** A tab's view: the rich editor, source mode, or split view (source mode
 *  with a preview). */
export interface ViewModeFields {
  sourceMode: boolean;
  splitView?: boolean;
}

export function viewModeFields(mode: ViewMode): ViewModeFields {
  return { sourceMode: mode !== "rich", splitView: mode === "split" };
}

export function viewModeOf({
  sourceMode,
  splitView,
}: ViewModeFields): ViewMode {
  return !sourceMode ? "rich" : splitView ? "split" : "source";
}

let current: ViewMode = "rich";

/** Settings' view mode, for code that makes tabs without the settings at
 *  hand (useSourceModes keeps it). */
export function setCurrentViewMode(mode: ViewMode): void {
  current = mode;
}

/** The view a new document opens in: every document's. */
export function lastViewMode(): ViewModeFields {
  return viewModeFields(current);
}
