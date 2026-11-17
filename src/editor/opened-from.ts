import { defaultValueCtx, editorStateOptionsCtx } from "@milkdown/kit/core";
import type { Ctx, MilkdownPlugin } from "@milkdown/kit/ctx";
import {
  historyKeymap,
  historyProviderConfig,
  redoCommand,
  undoCommand,
} from "@milkdown/kit/plugin/history";
import { Selection } from "@milkdown/kit/prose/state";
import { $ctx, $prose } from "@milkdown/kit/utils";
import { historyFrom } from "./left-history";
import type { TabLeft } from "./tab-left";

// The editor's side of tab-left.ts: built from what the tab's last editor
// left. Apart from it, so the store loads without the editor.

/** What this editor was given to open with. */
export const openedFromCtx = $ctx<TabLeft | null, "openedFrom">(
  null,
  "openedFrom",
);

/** The editor opens with `markdown`, or as the tab's last editor left it:
 *  that document itself, not its text parsed again, so every position in
 *  the selection and the history holds. */
export function openWith(
  ctx: Ctx,
  markdown: string,
  from: TabLeft | null,
): void {
  ctx.set(openedFromCtx.key, from);
  ctx.set(
    defaultValueCtx,
    from ? { type: "json", value: from.doc as never } : markdown,
  );
  if (!from) return;
  ctx.set(editorStateOptionsCtx, (options) => {
    try {
      const selection = Selection.fromJSON(options.doc!, from.selection);
      return { ...options, selection };
    } catch {
      return options;
    }
  });
}

/** Undo and redo, with the history the tab's last editor left. */
export const historyOpened: MilkdownPlugin[] = [
  historyProviderConfig,
  $prose((ctx) =>
    historyFrom(
      ctx.get(historyProviderConfig.key),
      ctx.get(openedFromCtx.key)?.history ?? null,
    ),
  ),
  historyKeymap,
  undoCommand,
  redoCommand,
].flat();
