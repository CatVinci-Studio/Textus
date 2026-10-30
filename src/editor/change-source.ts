import { isHistoryTransaction } from "@milkdown/kit/prose/history";
import {
  Plugin,
  PluginKey,
  type EditorState,
  type Transaction,
} from "@milkdown/kit/prose/state";
import { $prose } from "@milkdown/kit/utils";

/**
 * Who changed the document: the user typing, pasting or using the keyboard;
 * Textus AI (an accepted proposal, a completion, a grammar fix); the file
 * reloaded from disk; a plugin through its API; or undo and redo. Where the
 * change is made marks its transaction; anything unmarked is the user's.
 */
export type ChangeSource = "user" | "ai" | "disk" | "plugin" | "history";

const META = "textus-change-source";

/** Which of several changes since the last report is told: the user's
 *  first, so a plugin timing the user's writing never misses it. */
const RANK: Record<ChangeSource, number> = {
  user: 4,
  history: 3,
  ai: 2,
  plugin: 1,
  disk: 0,
};

export function markChangeSource<T extends Transaction>(
  tr: T,
  source: ChangeSource,
): T {
  tr.setMeta(META, source);
  return tr;
}

/** A transaction's source; null for one that isn't a change of its own:
 *  no change, the follow-up of another, or bookkeeping kept out of undo. */
export function transactionSource(tr: Transaction): ChangeSource | null {
  if (!tr.docChanged || tr.getMeta("appendedTransaction")) return null;
  const marked = tr.getMeta(META) as ChangeSource | undefined;
  if (marked) return marked;
  if (isHistoryTransaction(tr)) return "history";
  if (tr.getMeta("addToHistory") === false) return null;
  return "user";
}

export function strongerSource(
  a: ChangeSource | null,
  b: ChangeSource | null,
): ChangeSource | null {
  if (!a) return b;
  if (!b) return a;
  return RANK[b] > RANK[a] ? b : a;
}

interface SourceSpec {
  take(): ChangeSource;
}

const key = new PluginKey("change-source");

/** Gathers the sources of the changes since they were last taken. */
export const changeSourcePlugin = $prose(() => {
  let pending: ChangeSource | null = null;
  // Bookkeeping alone (a picture's address settled) counts as the change
  // it followed.
  let last: ChangeSource = "user";
  const take = () => {
    last = pending ?? last;
    pending = null;
    return last;
  };
  return new Plugin({
    key,
    take,
    appendTransaction(trs) {
      for (const tr of trs)
        pending = strongerSource(pending, transactionSource(tr));
      return null;
    },
  } as ConstructorParameters<typeof Plugin>[0] & SourceSpec);
});

/** The source of the changes since this was last asked. */
export function takeChangeSource(state: EditorState): ChangeSource {
  const spec = key.get(state)?.spec as Partial<SourceSpec> | undefined;
  return spec?.take?.() ?? "user";
}
