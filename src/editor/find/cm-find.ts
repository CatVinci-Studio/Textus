import { isolateHistory } from "@codemirror/commands";
import {
  StateEffect,
  StateField,
  type EditorState,
  type Extension,
} from "@codemirror/state";
import { Decoration, EditorView } from "@codemirror/view";
import {
  compileQuery,
  matchesIn,
  nextFind,
  NO_FIND,
  type FindMeta,
  type FindState,
} from "./find-query";
import type { FindBackend } from "./find-backend";

const findStep = StateEffect.define<FindMeta>();

const searchIn =
  (state: EditorState) =>
  (query: string, caseSensitive: boolean, useRegex: boolean) => {
    if (!query) return { matches: [], error: false };
    const regex = compileQuery(query, caseSensitive, useRegex);
    if (!regex) return { matches: [], error: true };
    return {
      matches: matchesIn(state.doc.toString(), regex, (from, to) => ({
        from,
        to,
      })),
      error: false,
    };
  };

const match = Decoration.mark({ class: "find-match" });
const active = Decoration.mark({ class: "find-match find-match-active" });

/** The source's search, kept as the rich document's is: the same steps,
 *  the same highlights. */
const findField = StateField.define<FindState>({
  create: () => NO_FIND,
  update(prev, tr) {
    const caret = tr.state.selection.main.from;
    let next = prev;
    for (const effect of tr.effects)
      if (effect.is(findStep))
        next = nextFind(next, effect.value, false, caret, searchIn(tr.state));
    if (next === prev && tr.docChanged)
      next = nextFind(prev, undefined, true, caret, searchIn(tr.state));
    return next;
  },
  provide: (field) =>
    EditorView.decorations.from(field, (find) =>
      Decoration.set(
        find.matches
          .filter((m) => m.to > m.from)
          .map((m, i) =>
            (i === find.activeIndex ? active : match).range(m.from, m.to),
          ),
      ),
    ),
});

/** What a source editor needs for the find bar. */
export const sourceFind: Extension = findField;

/** The find bar on a document's source; `viewOf` gives its view once
 *  made (null before, and nothing is done then). */
export function cmFind(viewOf: () => EditorView | null): FindBackend {
  const state = () => viewOf()?.state.field(findField, false) ?? NO_FIND;
  const on = (fn: (view: EditorView) => void) => {
    const view = viewOf();
    if (view) fn(view);
  };
  return {
    apply: (meta) => {
      on((view) => view.dispatch({ effects: findStep.of(meta) }));
      return state();
    },
    state,
    replace: (edits) =>
      on((view) => {
        view.dispatch({
          changes: edits.map(({ from, to, text }) => ({
            from,
            to,
            insert: text,
          })),
          annotations: isolateHistory.of("full"),
          userEvent: "input.replace",
        });
        view.focus();
      }),
    clear: (select, focus) =>
      on((view) => {
        view.dispatch({
          effects: findStep.of({ type: "clear" }),
          selection: select
            ? { anchor: select.from, head: select.to }
            : undefined,
        });
        if (focus) view.focus();
      }),
    selectedText: () => {
      const view = viewOf();
      if (!view) return "";
      const { from, to } = view.state.selection.main;
      return view.state.sliceDoc(from, to);
    },
    reveal: (m) =>
      on((view) =>
        view.dispatch({
          effects: EditorView.scrollIntoView(m.from, { y: "center" }),
        }),
      ),
    focus: () => on((view) => view.focus()),
    contains: (el) => !!viewOf()?.dom.contains(el),
  };
}
