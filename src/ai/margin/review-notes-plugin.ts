import { Plugin, PluginKey } from "@milkdown/kit/prose/state";
import { Decoration, DecorationSet } from "@milkdown/kit/prose/view";
import type { Node as ProseNode } from "@milkdown/kit/prose/model";
import { $prose } from "@milkdown/kit/utils";
import type { FoldAttention } from "../../editor/html/details-fold";

/** A note pinned to its passage, drawn in the margin or, with no room,
 *  behind a numbered badge after the passage. */
export interface ReviewNote {
  /** The add_comment call's id. */
  id: string;
  from: number;
  to: number;
  comment: string;
  /** Its badge's number, also shown on its card in the chat. */
  num: number;
  /** The writer's own note rather than the AI's. */
  by?: "me";
}

/** Numbers new notes after the existing ones in the order the AI left them,
 *  matching the chat's cards; never renumbers. Back to 1 once none is left. */
export function numberNotes(
  kept: readonly ReviewNote[],
  added: readonly Omit<ReviewNote, "num">[],
): ReviewNote[] {
  let last = kept.reduce((max, note) => Math.max(max, note.num), 0);
  return [...kept, ...added.map((note) => ({ ...note, num: ++last }))];
}

type NotesMeta =
  | { type: "set"; notes: ReviewNote[] }
  | { type: "remove"; id: string }
  /** The note under the pointer (its passage and card light up together). */
  | { type: "hot"; id: string | null }
  /** Badges instead of margin cards. */
  | { type: "compact"; compact: boolean };

interface NotesState {
  notes: ReviewNote[];
  hot: string | null;
  compact: boolean;
  decoration: DecorationSet;
}

export const reviewNotesKey = new PluginKey<NotesState>("review-notes");

function build(
  doc: ProseNode,
  notes: ReviewNote[],
  hot: string | null,
  compact: boolean,
  onBadge: (id: string, el: HTMLElement) => void,
): DecorationSet {
  const decos: Decoration[] = [];
  notes.forEach((note) => {
    decos.push(
      Decoration.inline(note.from, note.to, {
        class: `review-anchor${hot === note.id ? " review-anchor-hot" : ""}`,
        "data-note": note.id,
      }),
    );
    if (compact)
      decos.push(
        Decoration.widget(
          note.to,
          () => {
            const badge = document.createElement("button");
            badge.type = "button";
            badge.className = "review-badge";
            badge.contentEditable = "false";
            badge.dataset.note = note.id;
            badge.textContent = String(note.num);
            badge.addEventListener("mousedown", (e) => e.preventDefault());
            badge.addEventListener("click", (e) => {
              e.preventDefault();
              e.stopPropagation();
              onBadge(note.id, badge);
            });
            return badge;
          },
          {
            side: 1,
            key: `review-badge-${note.id}-${note.num}`,
            ignoreSelection: true,
            stopEvent: () => true,
          },
        ),
      );
  });
  return DecorationSet.create(doc, decos);
}

/** Keeps the notes on their passages through edits and draws their marks
 *  and badges. Which notes exist is decided outside. */
export function createReviewNotesPlugin(options: {
  /** The notes changed (set, mapped, dropped) - React's only way to learn. */
  onChange: (notes: ReviewNote[]) => void;
  /** A badge was clicked: open its note there. */
  onBadge: (id: string, el: HTMLElement) => void;
}) {
  return $prose(
    () =>
      new Plugin<NotesState>({
        key: reviewNotesKey,
        // A note on text folded in a <details> opens it, so its passage and
        // margin card have somewhere to be.
        foldAttention: ((state) =>
          (reviewNotesKey.getState(state)?.notes ?? []).map((note) => ({
            key: `note:${note.id}`,
            from: note.from,
            to: note.to,
          }))) satisfies FoldAttention,
        state: {
          init: () => ({
            notes: [],
            hot: null,
            compact: false,
            decoration: DecorationSet.empty,
          }),
          apply(tr, prev) {
            const meta = tr.getMeta(reviewNotesKey) as NotesMeta | undefined;
            let { notes, hot, compact } = prev;
            if (meta?.type === "set") notes = meta.notes;
            else if (meta?.type === "remove")
              notes = notes.filter((n) => n.id !== meta.id);
            else if (meta?.type === "hot") hot = meta.id;
            else if (meta?.type === "compact") compact = meta.compact;
            if (tr.docChanged && notes.length > 0) {
              const mapped = notes.flatMap((n) => {
                const from = tr.mapping.map(n.from, 1);
                const to = tr.mapping.map(n.to, -1);
                if (from >= to) return [];
                return from === n.from && to === n.to
                  ? [n]
                  : [{ ...n, from, to }];
              });
              // Typing elsewhere moves nothing: keep the array, so React
              // isn't told about every keystroke.
              if (
                mapped.length !== notes.length ||
                mapped.some((n, i) => n !== notes[i])
              )
                notes = mapped;
            }
            if (
              notes === prev.notes &&
              hot === prev.hot &&
              compact === prev.compact
            )
              return tr.docChanged
                ? {
                    ...prev,
                    decoration: prev.decoration.map(tr.mapping, tr.doc),
                  }
                : prev;
            return {
              notes,
              hot,
              compact,
              decoration: build(tr.doc, notes, hot, compact, options.onBadge),
            };
          },
        },
        props: {
          decorations: (state) => reviewNotesKey.getState(state)?.decoration,
        },
        view() {
          let last: ReviewNote[] = [];
          return {
            update(view) {
              const notes = reviewNotesKey.getState(view.state)?.notes ?? [];
              if (notes !== last) {
                last = notes;
                options.onChange(notes);
              }
            },
          };
        },
      }),
  );
}

/** The add_comment calls in a conversation's turns, in order. */
export function commentCalls(
  turns: readonly {
    kind: string;
    name?: string;
    call_id?: string;
    arguments?: string;
  }[],
): { id: string; anchor: string; comment: string; block?: string }[] {
  const out: {
    id: string;
    anchor: string;
    comment: string;
    block?: string;
  }[] = [];
  for (const turn of turns) {
    if (
      turn.kind !== "ToolCall" ||
      turn.name !== "add_comment" ||
      !turn.call_id
    )
      continue;
    try {
      const args = JSON.parse(turn.arguments ?? "");
      if (typeof args.anchor !== "string" || typeof args.comment !== "string")
        continue;
      out.push({
        id: turn.call_id,
        anchor: args.anchor,
        comment: args.comment,
        block: typeof args.block === "string" ? args.block : undefined,
      });
    } catch {
      // Still streaming in: its arguments aren't JSON yet.
    }
  }
  return out;
}
