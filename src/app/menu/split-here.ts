import { showNotice } from "../../engine/controls/notices";
import {
  besideLayout,
  openBeside,
  splitEditor,
} from "../../engine/layout/store";
import type { SplitLayout } from "../../engine/layout/ops";
import type { SplitDirection } from "../../engine/layout/tree";
import { currentStrings } from "../../i18n/current";
import { refusedForHeight } from "../../engine/frame/frame-store";

/** Says a split wasn't made for want of room: the menu, a tab dropped
 *  on an edge, a document opened beside. */
export function sayNoRoom(): void {
  const t = currentStrings();
  showNotice(refusedForHeight() ? t.splitNoRoomLow : t.splitNoRoom, {
    tone: "warning",
  });
}

/** Splits the island in use, or says why the window has no room for it:
 *  the documents never go under their least width for a split. */
export function splitHere(direction: SplitDirection): void {
  if (!splitEditor(direction)) sayNoRoom();
}

/** Shows `tabId` beside `from` (openBeside), or says why it can't. `say`
 *  false: a plugin asked, not the user; with no room it is just a tab. */
export function openBesideOrSay(
  tabId: string,
  from: string | null,
  say = true,
): void {
  if (!openBeside(tabId, from) && say) sayNoRoom();
}

/** `now` with `tabId` beside `from` as it arrives; else `now`, and the
 *  window says why when it was too narrow (unless `say` is false). */
export function besideOrSay(
  now: SplitLayout,
  tabId: string,
  from: string | null,
  say = true,
): SplitLayout {
  const { next, noRoom } = besideLayout(now, tabId, from);
  if (noRoom && say) sayNoRoom();
  return next ?? now;
}
