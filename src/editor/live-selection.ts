import { TextSelection } from "@milkdown/kit/prose/state";
import type { EditorState, Transaction } from "@milkdown/kit/prose/state";
import type { EditorView } from "@milkdown/kit/prose/view";

/**
 * The caret and selection where the browser has them, which can run ahead
 * of the editor state: a key handler acts on what is on screen.
 */

export function setCaret(view: EditorView, pos: number): void {
  view.dispatch(
    view.state.tr.setSelection(TextSelection.create(view.state.doc, pos)),
  );
}

/**
 * Collapse the transaction's selection to `pos`. Every enclosure-creating
 * edit places the caret through this: a new or completed shell puts it
 * inside at the content start; closing behind the caret or wrapping a
 * selection puts it after the node.
 */
export function caretAt(tr: Transaction, pos: number): Transaction {
  return tr.setSelection(TextSelection.create(tr.doc, pos));
}

/**
 * Where the browser's caret is, as a document position: null when the DOM
 * selection isn't a caret or isn't at a position the editor knows.
 */
export function liveCaretPos(view: EditorView): number | null {
  // ShadowRoot.getSelection is nonstandard (Blink-only), hence the guard.
  const root = view.root as {
    getSelection?: () => globalThis.Selection | null;
  };
  const domSel = root.getSelection ? root.getSelection() : null;
  if (
    !domSel ||
    domSel.rangeCount === 0 ||
    !domSel.isCollapsed ||
    !domSel.anchorNode
  )
    return null;
  try {
    // -1 for a caret in DOM the document doesn't own (a revision's widget).
    const pos = view.posAtDOM(domSel.anchorNode, domSel.anchorOffset);
    return pos >= 0 && pos <= view.state.doc.content.size ? pos : null;
  } catch {
    return null;
  }
}

/** The browser's selection as document positions, anchor then head: null
 *  for a caret, no selection, or one outside what the editor knows. */
export function liveRange(view: EditorView): [number, number] | null {
  const root = view.root as {
    getSelection?: () => globalThis.Selection | null;
  };
  const domSel = root.getSelection ? root.getSelection() : null;
  if (
    !domSel ||
    domSel.rangeCount === 0 ||
    domSel.isCollapsed ||
    !domSel.anchorNode ||
    !domSel.focusNode ||
    !view.dom.contains(domSel.anchorNode) ||
    !view.dom.contains(domSel.focusNode)
  )
    return null;
  try {
    return [
      view.posAtDOM(domSel.anchorNode, domSel.anchorOffset),
      view.posAtDOM(domSel.focusNode, domSel.focusOffset),
    ];
  } catch {
    return null;
  }
}

/**
 * The state's selection can lag behind the DOM caret: native caret moves
 * reach ProseMirror through an async selectionchange, so a fast keystroke
 * runs against a stale position and a boundary crossing slips through to
 * native movement. This returns a state with the selection read from the DOM.
 */
export function stateWithLiveSelection(view: EditorView): EditorState {
  const { state } = view;
  // A range the browser has but the state doesn't fully yet (Shift+Arrow just
  // before Mod+B): the shortcut wraps what is on screen. A node selection is
  // the state's own.
  const range = liveRange(view);
  const { selection } = state;
  if (
    range &&
    range[0] !== range[1] &&
    (selection.empty || selection instanceof TextSelection) &&
    (selection.anchor !== range[0] || selection.head !== range[1])
  ) {
    const [anchor, head] = range;
    if (Math.max(anchor, head) <= state.doc.content.size)
      return state.apply(
        state.tr.setSelection(
          TextSelection.between(
            state.doc.resolve(anchor),
            state.doc.resolve(head),
          ),
        ),
      );
  }
  if (!state.selection.empty) return state;
  const pos = liveCaretPos(view);
  if (
    pos === null ||
    pos < 0 ||
    pos > state.doc.content.size ||
    pos === state.selection.from
  )
    return state;
  const $pos = state.doc.resolve(pos);
  return state.apply(state.tr.setSelection(TextSelection.between($pos, $pos)));
}
