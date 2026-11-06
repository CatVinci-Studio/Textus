import { closeHistory, undo, undoDepth } from "@milkdown/kit/prose/history";
import type { Node as ProseNode, Schema } from "@milkdown/kit/prose/model";
import {
  Plugin,
  PluginKey,
  TextSelection,
  type EditorState,
} from "@milkdown/kit/prose/state";
import { Step, Transform } from "@milkdown/kit/prose/transform";
import type { EditorView } from "@milkdown/kit/prose/view";
import { $prose } from "@milkdown/kit/utils";
import { undoFiles } from "../platform/ipc-files";
import { fnv1a } from "../utils/hash";

// A document's undo history outlives its editor, like Vim's undofile: kept
// when the editor goes (its tab let go after a while out of sight, or
// closed), given back when the document opens at the same text again.

/** Each undo step, newest first, as the steps that undo it. */
type Kept = unknown[][];

/** What the text is known by: the history is used only at this text. */
export function docHash(doc: ProseNode): string {
  return fnv1a(JSON.stringify(doc.toJSON())).toString(36);
}

/** prosemirror-history's plugin, known by its config (its key is private). */
function isHistory(plugin: Plugin): boolean {
  const { config } = plugin.spec as { config?: { newGroupDelay?: unknown } };
  return config?.newGroupDelay !== undefined;
}

/** The history as the steps that undo it, newest first: found by undoing
 *  on a copy of the state, so the editor itself never moves. */
export function captureHistory(state: EditorState): Kept {
  const undos: Kept = [];
  // The history alone: the editor's other plugins (Milkdown's) may run
  // only while it lives, and this runs as it goes.
  let now = state.reconfigure({ plugins: state.plugins.filter(isHistory) });
  while (undoDepth(now) > 0) {
    let steps: unknown[] = [];
    const undone = undo(now, (tr) => {
      steps = tr.steps.map((s) => s.toJSON());
      now = now.apply(tr);
    });
    if (!undone || steps.length === 0) break;
    undos.push(steps);
  }
  return undos;
}

/** The doc each undo step starts from, oldest first, and the steps that
 *  redo each; null when they don't fit `doc`. */
function replay(
  schema: Schema,
  doc: ProseNode,
  undos: Kept,
): { base: ProseNode; redos: Step[][] } | null {
  let at = doc;
  const redos: Step[][] = [];
  try {
    for (const group of undos) {
      const tr = new Transform(at);
      for (const json of group) tr.step(Step.fromJSON(schema, json));
      redos.unshift(
        tr.steps.map((step, i) => step.invert(tr.docs[i])).reverse(),
      );
      at = tr.doc;
    }
  } catch {
    return null;
  }
  return { base: at, redos };
}

/** `view`'s history made again from `undos`, its text unchanged: the
 *  oldest text, then each step redone as an undo step of its own. False
 *  when they don't fit what it shows. */
export function restoreHistory(view: EditorView, undos: Kept): boolean {
  const { state } = view;
  const replayed = replay(state.schema, state.doc, undos);
  if (!replayed) return false;
  const { from, to } = state.selection;
  let next = state.apply(
    state.tr
      .replaceWith(0, state.doc.content.size, replayed.base.content)
      .setMeta("addToHistory", false)
      .setMeta(undoFileKey, true),
  );
  for (const steps of replayed.redos) {
    const tr = next.tr;
    for (const step of steps) tr.step(step);
    next = next.apply(closeHistory(tr).setMeta(undoFileKey, true));
  }
  if (!next.doc.eq(state.doc)) return false;
  const size = next.doc.content.size;
  next = next.apply(
    next.tr
      .setSelection(
        TextSelection.create(
          next.doc,
          Math.min(from, size),
          Math.min(to, size),
        ),
      )
      .setMeta("addToHistory", false)
      .setMeta(undoFileKey, true),
  );
  view.updateState(next);
  return true;
}

export const undoFileKey = new PluginKey("undo-file");

/** Keeps the document's undo history when its editor goes, and gives it
 *  back when it opens at the same text. Nothing for a draft with no file. */
export function createUndoFilePlugin(docPath: () => string | null) {
  return $prose(
    () =>
      new Plugin({
        key: undoFileKey,
        view(view) {
          const path = docPath();
          const opened = view.state.doc;
          if (path)
            void undoFiles
              .load(path, docHash(opened))
              .then((kept) => {
                // Only before anything has happened here.
                if (!kept || view.isDestroyed || view.state.doc !== opened)
                  return;
                restoreHistory(view, JSON.parse(kept) as Kept);
              })
              .catch(() => {});
          return {
            destroy() {
              const at = docPath();
              const { state } = view;
              if (!at || undoDepth(state) === 0) return;
              void undoFiles
                .save(
                  at,
                  docHash(state.doc),
                  JSON.stringify(captureHistory(state)),
                )
                .catch(() => {});
            },
          };
        },
      }),
  );
}
