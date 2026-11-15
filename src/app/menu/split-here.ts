import { showNotice } from "../../engine/controls/notices";
import {
  besideLayout,
  besideShort,
  splitEditor,
} from "../../engine/layout/store";
import type { SplitLayout } from "../../engine/layout/ops";
import type { SplitDirection } from "../../engine/layout/tree";
import { currentStrings } from "../../i18n/current";

/** Says a split wasn't made for want of room: the menu, a tab dropped
 *  on an edge, a document opened beside. */
export function sayNoRoom(): void {
  showNotice(currentStrings().splitNoRoom, { tone: "warning" });
}

/** Splits the island in use, or says why the window has no room for it:
 *  the documents never go under their least width for a split. */
export function splitHere(direction: SplitDirection): void {
  const short = splitEditor(direction);
  if (short) sayNoRoom();
}

/** `now` with `tabId` beside `from` as it arrives; else `now`, and the
 *  window says why when it was too narrow. */
export function besideOrSay(
  now: SplitLayout,
  tabId: string,
  from: string | null,
): SplitLayout {
  const next = besideLayout(now, tabId, from);
  if (next) return next;
  const short = besideShort(now, tabId, from);
  if (short) sayNoRoom();
  return now;
}
