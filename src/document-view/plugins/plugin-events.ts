import type { Ctx } from "@milkdown/kit/ctx";
import { emitPluginEvent, pluginsListen } from "../../plugins/app-bridge";
import { selectionText } from "./plugin-edits";

/**
 * What the document in front tells plugins as the user works
 * (textus.editor.onDidChange / onDidChangeSelection): only for the active
 * tab, only when a plugin listens - nothing is read otherwise - and the
 * selection once it settles, not on every arrow key.
 */

/** The editor's (already debounced) report of an edit. */
export function documentChangedForPlugins(
  active: boolean,
  path: string | null,
): void {
  if (active && pluginsListen("documentChange"))
    emitPluginEvent("documentChange", { path });
}

let selectionTimer: ReturnType<typeof setTimeout> | null = null;
/** How long a selection must stay before plugins hear of it. */
const SELECTION_SETTLE_MS = 150;

export function selectionChangedForPlugins(active: boolean, ctx: Ctx): void {
  if (!active || !pluginsListen("selection")) return;
  if (selectionTimer) clearTimeout(selectionTimer);
  selectionTimer = setTimeout(() => {
    selectionTimer = null;
    try {
      emitPluginEvent("selection", { text: selectionText(ctx) });
    } catch {
      /* the editor went away */
    }
  }, SELECTION_SETTLE_MS);
}
