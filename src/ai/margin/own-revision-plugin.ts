import { Plugin, PluginKey } from "@milkdown/kit/prose/state";
import {
  Decoration,
  DecorationSet,
  type EditorView,
} from "@milkdown/kit/prose/view";
import type { Node as ProseNode } from "@milkdown/kit/prose/model";
import { StepMap } from "@milkdown/kit/prose/transform";
import { ChangeSet } from "@milkdown/kit/prose/changeset";
import { $prose } from "@milkdown/kit/utils";
import { shownChanges, type ChangeSpan } from "./own-change-spans";
import {
  CHECK_SVG,
  CROSS_SVG,
  type SentencePickLabels,
} from "../revision/pending-widgets";

/** Track My Changes: the writer's edits shown against the text as tracking
 *  began. The document holds the new text; the original never enters it. */

/** The callId of a revision card that is the writer's own change. */
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
  /** The changes as shown (own-change-spans.ts). */
  shown: readonly ChangeSpan[];
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
  shown: readonly ChangeSpan[],
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
  shown: readonly ChangeSpan[],
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
            del.className = `own-delete${c.toB > c.fromB ? "" : " own-delete-only"}${lit}`;
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
    // Its ✓ / ✕, shown in the "all in the text" view as the AI's are.
    decos.push(
      Decoration.widget(c.toB, (view) => pick(view, index), {
        side: 2,
        key: `own-pick-${index}`,
        ignoreSelection: true,
        stopEvent: () => true,
      }),
    );
    if (c.toB > c.fromB)
      decos.push(
        Decoration.inline(c.fromB, c.toB, {
          class: `own-insert${c.toA > c.fromA ? "" : " own-insert-only"}${lit}`,
          ...attrs,
        }),
      );
  });
  return DecorationSet.create(doc, decos);
}

/** How a change's ✓ / ✕ in the text decide it, by editor. */
export interface OwnPicker {
  labels: SentencePickLabels;
  decide: (index: number, take: boolean) => void;
}

const pickers = new WeakMap<EditorView, OwnPicker>();

/** Lets `view`'s changes be decided from the text. */
export function setOwnPicker(view: EditorView, picker: OwnPicker) {
  pickers.set(view, picker);
  return () => {
    if (pickers.get(view) === picker) pickers.delete(view);
  };
}

function pick(view: EditorView, index: number): HTMLElement {
  const box = document.createElement("span");
  box.className = "pending-pick pending-pick-open own-pick";
  box.contentEditable = "false";
  Object.assign(box.dataset, { call: OWN_CHANGES, index });
  const button = (take: boolean) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = take ? "pending-pick-take" : "pending-pick-keep";
    b.innerHTML = take ? CHECK_SVG : CROSS_SVG;
    const picker = pickers.get(view);
    const label = picker ? picker.labels[take ? "take" : "keep"] : "";
    b.title = label;
    b.setAttribute("aria-label", label);
    // A click decides; the caret stays where it was.
    b.addEventListener("mousedown", (e) => e.preventDefault());
    b.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      pickers.get(view)?.decide(index, take);
    });
    return b;
  };
  box.append(button(true), button(false));
  return box;
}

/** Who hears of the changes, by editor. */
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
              : set && base
                ? shownChanges(set.changes, base, tr.doc)
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
