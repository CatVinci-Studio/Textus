import { Plugin, PluginKey } from "@milkdown/kit/prose/state";
import {
  Decoration,
  DecorationSet,
  type EditorView,
} from "@milkdown/kit/prose/view";
import type { Node as ProseNode } from "@milkdown/kit/prose/model";
import { StepMap } from "@milkdown/kit/prose/transform";
import {
  ChangeSet,
  simplifyChanges,
  type Change,
} from "@milkdown/kit/prose/changeset";
import { $prose } from "@milkdown/kit/utils";

/**
 * Track My Changes (useOwnRevisions.ts): the writer's own edits shown as
 * changes against the text as it was when tracking began - what was
 * deleted struck through where it was, what was added marked - each to
 * accept or reject. The document always holds the new text, so typing is
 * typing; the original (`base`) is held here, and kept beside the app's
 * data, never in the Markdown.
 */

/** The margin's name for these changes: a revision card whose callId is
 *  this is the writer's own (useReviewNotes, MarginCards). */
export const OWN_CHANGES = "own";

/** One change, as the margin shows it. */
export interface OwnChange {
  index: number;
  /** Where it is in the document now. */
  from: number;
  to: number;
  before: string;
  after: string;
}

interface OwnRevisionState {
  base: ProseNode | null;
  set: ChangeSet | null;
  /** The changes as shown - a change inside a word grown to the whole
   *  word ("quiet" for "still", not "quie" for "stil") - which the margin
   *  numbers and decides by. */
  shown: readonly Change[];
  hot: number | null;
  decoration: DecorationSet;
}

type Meta =
  | { type: "start" }
  | { type: "stop" }
  /** Tracking against this original (loaded, or one change accepted). */
  | { type: "base"; base: ProseNode }
  | { type: "hot"; index: number | null };

export const ownRevisionKey = new PluginKey<OwnRevisionState>("own-revisions");

/** The changes from `base` to `doc`, word by word. */
export function diff(base: ProseNode, doc: ProseNode): ChangeSet {
  return ChangeSet.create(base).addSteps(
    doc,
    [new StepMap([0, base.content.size, doc.content.size])],
    null,
  );
}

export function ownChanges(
  base: ProseNode,
  shown: readonly Change[],
  doc: ProseNode,
): OwnChange[] {
  return shown.map((c, index) => ({
    index,
    from: c.fromB,
    to: Math.max(c.toB, c.fromB),
    before: base.textBetween(c.fromA, c.toA, "\n", " "),
    after: doc.textBetween(c.fromB, c.toB, "\n", " "),
  }));
}

function build(
  base: ProseNode,
  shown: readonly Change[],
  doc: ProseNode,
  hot: number | null,
): DecorationSet {
  const decos: Decoration[] = [];
  shown.forEach((c, index) => {
    const lit = hot === index ? " own-change-hot" : "";
    const attrs = {
      "data-call": OWN_CHANGES,
      "data-index": String(index),
    };
    if (c.toA > c.fromA)
      decos.push(
        Decoration.widget(
          c.fromB,
          () => {
            const del = document.createElement("del");
            del.className = `own-delete${lit}`;
            Object.assign(del.dataset, { call: OWN_CHANGES, index });
            del.textContent = base.textBetween(c.fromA, c.toA, " ", " ");
            return del;
          },
          {
            side: -1,
            key: `own-del-${index}-${c.fromA}-${c.toA}${lit}`,
            ignoreSelection: true,
          },
        ),
      );
    if (c.toB > c.fromB)
      decos.push(
        Decoration.inline(c.fromB, c.toB, {
          class: `own-insert${lit}`,
          ...attrs,
        }),
      );
  });
  return DecorationSet.create(doc, decos);
}

/** Who hears of the changes, by editor (useOwnRevisions). */
const listeners = new WeakMap<
  EditorView,
  (changes: OwnChange[] | null) => void
>();

/** Hears `view`'s tracked changes - null while it isn't tracking. */
export function watchOwnChanges(
  view: EditorView,
  listener: (changes: OwnChange[] | null) => void,
): () => void {
  listeners.set(view, listener);
  return () => {
    if (listeners.get(view) === listener) listeners.delete(view);
  };
}

export const ownRevisionPlugin = $prose(
  () =>
    new Plugin<OwnRevisionState>({
      key: ownRevisionKey,
      state: {
        init: () => ({
          base: null,
          set: null,
          shown: [],
          hot: null,
          decoration: DecorationSet.empty,
        }),
        apply(tr, prev) {
          const meta = tr.getMeta(ownRevisionKey) as Meta | undefined;
          let { base, set, hot } = prev;
          if (meta?.type === "start") {
            base = tr.doc;
            set = ChangeSet.create(tr.doc);
          } else if (meta?.type === "stop") {
            base = null;
            set = null;
          } else if (meta?.type === "base") {
            base = meta.base;
            set = diff(meta.base, tr.doc);
          } else if (meta?.type === "hot") hot = meta.index;
          else if (tr.docChanged && set)
            set = set.addSteps(tr.doc, tr.mapping.maps, null);
          if (base === prev.base && set === prev.set && hot === prev.hot)
            return prev;
          const shown =
            set === prev.set
              ? prev.shown
              : set
                ? simplifyChanges(set.changes, tr.doc)
                : [];
          return {
            base,
            set,
            shown,
            hot,
            decoration: base
              ? build(base, shown, tr.doc, hot)
              : DecorationSet.empty,
          };
        },
      },
      props: {
        decorations: (state) => ownRevisionKey.getState(state)?.decoration,
      },
      view() {
        let last: ChangeSet | null | undefined;
        return {
          update(view) {
            const state = ownRevisionKey.getState(view.state);
            if (!state || state.set === last) return;
            last = state.set;
            listeners.get(view)?.(
              state.base
                ? ownChanges(state.base, state.shown, view.state.doc)
                : null,
            );
          },
        };
      },
    }),
);
