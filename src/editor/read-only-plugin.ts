import { Plugin, PluginKey, type EditorState } from "@milkdown/kit/prose/state";
import type { EditorView } from "@milkdown/kit/prose/view";
import { $prose } from "@milkdown/kit/utils";

/** Fired on the editor when a change was refused because the document is
 *  read-only. */
export const READ_ONLY_REFUSED = "textus:read-only-refused";

const readOnlyKey = new PluginKey<boolean>("read-only");

/** Makes the editor read-only, or editable again. */
export function setReadOnly(view: EditorView, on: boolean): void {
  if (readOnlyKey.getState(view.state) === on) return;
  view.dispatch(readOnlyTr(view.state, on));
}

/** The transaction that turns read-only on or off. */
export const readOnlyTr = (state: EditorState, on: boolean) =>
  state.tr.setMeta(readOnlyKey, on).setMeta("addToHistory", false);

/**
 * A read-only document: nothing changes it - typing, paste, a drop, undo, an
 * AI edit or a plugin's. A change the writer would expect (not one a plugin
 * makes on the side) fires READ_ONLY_REFUSED, so they hear why.
 */
export function createReadOnlyPlugin(): Plugin<boolean> {
  let dom: HTMLElement | null = null;
  const refuse = () =>
    dom?.dispatchEvent(new CustomEvent(READ_ONLY_REFUSED, { bubbles: true }));
  const refuseIfReadOnly = (state: EditorState) => {
    if (readOnlyKey.getState(state)) refuse();
    return false;
  };
  return new Plugin<boolean>({
    key: readOnlyKey,
    state: {
      init: () => false,
      apply: (tr, on) => (tr.getMeta(readOnlyKey) as boolean | undefined) ?? on,
    },
    view(view) {
      dom = view.dom;
      return { destroy: () => (dom = null) };
    },
    props: {
      editable: (state) => !readOnlyKey.getState(state),
      // Still focusable, for selecting and copying with the keys.
      attributes: (state): Record<string, string> =>
        readOnlyKey.getState(state) ? { tabindex: "0" } : {},
      // Not editable, the editor ignores these, so the writer hears why here.
      handleDOMEvents: {
        keydown: (view, event) => {
          const writes =
            (event.key.length === 1 && !event.metaKey && !event.ctrlKey) ||
            ["Backspace", "Delete", "Enter"].includes(event.key);
          if (writes && readOnlyKey.getState(view.state)) refuse();
          return false;
        },
        paste: (view) => refuseIfReadOnly(view.state),
        drop: (view) => refuseIfReadOnly(view.state),
        cut: (view) => refuseIfReadOnly(view.state),
      },
    },
    filterTransaction(tr, state) {
      if (!tr.docChanged || !readOnlyKey.getState(state)) return true;
      const aside =
        tr.getMeta("addToHistory") === false ||
        tr.getMeta("appendedTransaction") !== undefined;
      if (!aside) refuse();
      return false;
    },
  });
}

export const readOnlyPlugin = $prose(createReadOnlyPlugin);
