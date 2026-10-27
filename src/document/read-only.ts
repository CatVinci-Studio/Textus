import { getUiState, setUiState } from "../storage/ui-state";
import type { DocTab } from "./doc-tabs";

/** The documents left read-only, by path. */
function readOnlyPaths(): string[] {
  const kept = getUiState("readOnlyPaths");
  return Array.isArray(kept)
    ? kept.filter((p): p is string => typeof p === "string")
    : [];
}

/** Whether the tab is read-only: as set on it, else as its file was left. */
export function tabReadOnly(tab: DocTab): boolean {
  if (tab.readOnly !== undefined) return tab.readOnly;
  return tab.path !== null && readOnlyPaths().includes(tab.path);
}

/** Remembers whether the file at `path` is read-only, for when it opens
 *  again. */
export function keepReadOnly(path: string, on: boolean): void {
  const rest = readOnlyPaths().filter((p) => p !== path);
  setUiState("readOnlyPaths", on ? [...rest, path] : rest);
}
