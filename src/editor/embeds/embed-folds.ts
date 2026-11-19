import { setUiState, uiList } from "../../storage/ui-state";
import { loadSettings } from "../../prefs/settings-store";
import { blockFolded, setBlockFolded } from "../fold/block-fold";

// Which embeds the user folded, on this machine only, with every other
// drawn block's (block-fold.ts): the file keeps its ![[...]] as written.
// Shown as cards, an embed starts folded unless opened.

const asCards = () => loadSettings().embedDisplay === "card";

/** The folds kept in lists of their own before, moved in. */
function carryOldFolds(): void {
  const folded = uiList("foldedEmbeds");
  const opened = uiList("openedEmbeds");
  if (!folded.length && !opened.length) return;
  for (const key of folded) setBlockFolded(key, true);
  for (const key of opened) setBlockFolded(key, false);
  setUiState("foldedEmbeds", []);
  setUiState("openedEmbeds", []);
}

export function embedFolded(key: string): boolean {
  carryOldFolds();
  return blockFolded(key, asCards());
}

export function setEmbedFolded(key: string, folded: boolean): void {
  carryOldFolds();
  setBlockFolded(key, folded);
}
