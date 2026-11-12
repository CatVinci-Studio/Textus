import { showMessage } from "../../engine/controls/app-dialog";
import { splitEditor } from "../../engine/layout/store";
import type { SplitDirection } from "../../engine/layout/tree";
import { currentStrings } from "../../i18n/current";

/** Splits the island in use, or says why the window has no room for it:
 *  the documents never go under their least width for a split. */
export function splitHere(direction: SplitDirection): void {
  if (splitEditor(direction)) return;
  const t = currentStrings();
  void showMessage(t.splitNoRoom, {
    title: direction === "row" ? t.menuSplitRight : t.menuSplitDown,
  });
}
