import { getUiState, setUiState } from "../../storage/ui-state";

// Which embeds the user folded, on this machine only: the file keeps its
// ![[...]] as written.

/** Folds remembered at most; the oldest goes first. */
const KEPT = 300;

function folds(): string[] {
  const kept = getUiState("foldedEmbeds");
  return Array.isArray(kept)
    ? kept.filter((k): k is string => typeof k === "string")
    : [];
}

export function embedFolded(key: string): boolean {
  return folds().includes(key);
}

export function setEmbedFolded(key: string, folded: boolean): void {
  const rest = folds().filter((k) => k !== key);
  setUiState("foldedEmbeds", folded ? [...rest, key].slice(-KEPT) : rest);
}
