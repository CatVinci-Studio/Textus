import type { Ctx } from "@milkdown/kit/ctx";
import { editorViewCtx } from "@milkdown/kit/core";
import { emitPluginEvent, pluginsListen } from "../../plugins/app-bridge";
import { selectionText } from "./plugin-edits";
import { takeChangeSource } from "../../editor/change-source";

/**
 * What the document in front tells plugins as the user works: only for the
 * active tab, only when a plugin listens, and the selection once it settles.
 */

/** The editor's (already debounced) report of an edit. The source is taken
 *  either way, so a background tab's edits aren't told when it comes front. */
export function documentChangedForPlugins(
  active: boolean,
  path: string | null,
  ctx: Ctx,
): void {
  const source = takeChangeSource(ctx.get(editorViewCtx).state);
  if (active && pluginsListen("documentChange"))
    emitPluginEvent("documentChange", { path, source });
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
