import {
  defaultValueCtx,
  editorStateOptionsCtx,
  editorViewCtx,
  parserCtx,
} from "@milkdown/kit/core";
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
import type { SingleTildeMode } from "../prefs/settings-values";

// The editor's side of tab-left.ts: built from what the tab's last editor
// left. Apart from it, so the store loads without the editor.

/** How this editor reads one tilde (editor-core-syntax), left with its
 *  document so the next editor reuses it only if it reads it alike. */
export const singleTildeCtx = $ctx<SingleTildeMode, "singleTilde">(
  "subscript",
  "singleTilde",
);

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

/** The text changed since the last editor left (in source mode): the
 *  change goes in as one step the user can undo, after the history that
 *  came before it. */
export function catchUp(ctx: Ctx, markdown: string): void {
  const view = ctx.get(editorViewCtx);
  const now = ctx.get(parserCtx)(markdown);
  if (!now) return;
  const { doc } = view.state;
  const start = doc.content.findDiffStart(now.content);
  if (start === null) return;
  const end = doc.content.findDiffEnd(now.content);
  if (!end) return;
  let { a: endOld, b: endNew } = end;
  // Where the same text repeats, the two ends can cross the start.
  const overlap = start - Math.min(endOld, endNew);
  if (overlap > 0) {
    endOld += overlap;
    endNew += overlap;
  }
  view.dispatch(view.state.tr.replace(start, endOld, now.slice(start, endNew)));
}
