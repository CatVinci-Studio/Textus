import { getUiState, setUiState } from "../../storage/ui-state";
import { loadSettings } from "../../prefs/settings-store";

// Which embeds the user folded, on this machine only: the file keeps its
// ![[...]] as written. With embeds shown as cards, the ones opened instead.

/** Folds remembered at most; the oldest goes first. */
const KEPT = 300;

type Kept = "foldedEmbeds" | "openedEmbeds";

function kept(name: Kept): string[] {
  const list = getUiState(name);
  return Array.isArray(list)
    ? list.filter((k): k is string => typeof k === "string")
    : [];
}

/** The list that says otherwise than the setting: folded ones, or opened cards. */
const exceptions = (): Kept =>
  loadSettings().embedDisplay === "card" ? "openedEmbeds" : "foldedEmbeds";

export function embedFolded(key: string): boolean {
  const name = exceptions();
  return kept(name).includes(key) === (name === "foldedEmbeds");
}

export function setEmbedFolded(key: string, folded: boolean): void {
  const name = exceptions();
  const listed = folded === (name === "foldedEmbeds");
  const rest = kept(name).filter((k) => k !== key);
  setUiState(name, listed ? [...rest, key].slice(-KEPT) : rest);
}
