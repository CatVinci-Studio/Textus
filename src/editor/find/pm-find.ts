import { editorViewCtx } from "@milkdown/kit/core";
import { closeHistory } from "@milkdown/kit/prose/history";
import { TextSelection } from "@milkdown/kit/prose/state";
import type { EditorView } from "@milkdown/kit/prose/view";
import { findReplaceKey } from "./find-replace-plugin";
import { NO_FIND, type FindState } from "./find-query";
import type { FindBackend } from "./find-backend";
import type { EditorRunner } from "../useEditorRunner";
import { SMOOTH_SCROLL_MS } from "../lazy-blocks/lazy-blocks-drawer";
import { makeReachable } from "../reveal-position";

const stateOf = (view: EditorView): FindState =>
  findReplaceKey.getState(view.state) ?? NO_FIND;

const made = new WeakMap<EditorRunner, FindBackend>();

/** The find bar on the rich document, through its editor's runner: one per
 *  runner, so the bar's effects see the same one each render. */
export function pmFind(run: EditorRunner): FindBackend {
  let backend = made.get(run);
  if (!backend) made.set(run, (backend = makePmFind(run)));
  return backend;
}

function makePmFind(run: EditorRunner): FindBackend {
  const withView = <T>(fn: (view: EditorView) => T): T | undefined =>
    run((ctx) => fn(ctx.get(editorViewCtx)));
  return {
    apply: (meta) =>
      withView((view) => {
        view.dispatch(view.state.tr.setMeta(findReplaceKey, meta));
        return stateOf(view);
      }) ?? NO_FIND,
    state: () => withView(stateOf) ?? NO_FIND,
    replace: (edits) =>
      withView((view) => {
        let tr = view.state.tr;
        // Last first, so a replacement never shifts those still to come.
        for (const edit of [...edits].sort((a, b) => b.from - a.from))
          tr = tr.insertText(edit.text, edit.from, edit.to);
        view.dispatch(closeHistory(tr));
        view.focus();
      }),
    clear: (select, focus) =>
      withView((view) => {
        const tr = view.state.tr.setMeta(findReplaceKey, { type: "clear" });
        if (select)
          tr.setSelection(TextSelection.create(tr.doc, select.from, select.to));
        view.dispatch(tr);
        if (focus) view.focus();
      }),
    selectedText: () =>
      withView(({ state }) =>
        state.doc.textBetween(state.selection.from, state.selection.to, "\n"),
      ) ?? "",
    reveal: (match, smooth) =>
      withView((view) => {
        makeReachable(
          view,
          match.from,
          match.to,
          smooth ? SMOOTH_SCROLL_MS : 0,
        );
        try {
          const dom = view.domAtPos(match.from).node;
          const el = dom instanceof Element ? dom : dom.parentElement;
          el?.scrollIntoView({
            block: "center",
            behavior: smooth ? "smooth" : "auto",
          });
        } catch {
          // Not representable in the DOM right now.
        }
      }),
    focus: () => withView((view) => view.focus()),
    contains: (el) => withView((view) => view.dom.contains(el)) ?? false,
  };
}
