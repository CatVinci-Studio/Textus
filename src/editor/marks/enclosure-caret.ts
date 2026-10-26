import { TextSelection } from "@milkdown/kit/prose/state";
import { Fragment } from "@milkdown/kit/prose/model";
import type { EditorState, Transaction } from "@milkdown/kit/prose/state";
import type { Node as ProseNode } from "@milkdown/kit/prose/model";
import type { EditorView } from "@milkdown/kit/prose/view";
import {
  enclosureDelims,
  isEnclosure,
  isEnclosureName,
} from "./enclosure-runs";
import type { DeleteAction } from "./enclosure-moves";

/**
 * The caret where the browser has it, which can run ahead of the editor
 * state, and the enclosure moves and deletes applied to the view.
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

/** Remove an empty shell entirely, like erasing an auto-closed bracket pair. */
export function deleteShell(
  view: EditorView,
  start: number,
  node: ProseNode,
): void {
  const tr = view.state.tr.delete(start, start + node.nodeSize);
  tr.setSelection(TextSelection.create(tr.doc, start));
  view.dispatch(tr);
}

/**
 * Delete one of a node's delimiters: the node unwraps into literal text
 * that keeps the other delimiter ("*hello*" minus its closer -> "*hello").
 * Retyping the deleted delimiter re-forms the enclosure.
 */
export function deleteDelimiter(
  view: EditorView,
  start: number,
  node: ProseNode,
  drop: "opening" | "closing",
): void {
  const { state } = view;
  const { open, close } = enclosureDelims(node);
  const frag =
    drop === "closing"
      ? Fragment.from(state.schema.text(open)).append(node.content)
      : node.content.append(Fragment.from(state.schema.text(close)));
  const tr = state.tr.replaceWith(start, start + node.nodeSize, frag);
  tr.setSelection(
    TextSelection.create(
      tr.doc,
      drop === "closing" ? start + frag.size : start,
    ),
  );
  view.dispatch(tr);
}

export function applyDeleteAction(
  view: EditorView,
  action: DeleteAction,
): void {
  if (action.kind === "deleteShell")
    deleteShell(view, action.start, action.node);
  else deleteDelimiter(view, action.start, action.node, action.drop);
}

/**
 * The IME counterpart of redirecting misattributed input: WKWebView pulls
 * composed text into an adjacent enclosure, and nothing may dispatch during
 * composition. So the enclosures beside the caret are snapshotted at
 * compositionstart and the text moved back out after compositionend; any
 * mismatch with the snapshot bails rather than mangle text.
 */
export interface CompositionAnchor {
  side: "before" | "after";
  nodeStart: number;
  contentSize: number;
}

export function snapshotAdjacentEnclosures(
  state: EditorState,
): CompositionAnchor[] {
  const sel = state.selection;
  if (!sel.empty) return [];
  const $pos = sel.$from;
  // Composing inside code or maths stays there. Inside bold, text pulled into
  // the code beside the caret goes back out: `**a `b`|**`.
  const { name } = $pos.parent.type;
  if (isEnclosureName(name) && name !== "md_span") return [];
  const anchors: CompositionAnchor[] = [];
  const before = $pos.nodeBefore;
  if (before && isEnclosure(before) && !before.isBlock) {
    anchors.push({
      side: "after",
      nodeStart: sel.from - before.nodeSize,
      contentSize: before.content.size,
    });
  }
  const after = $pos.nodeAfter;
  if (after && isEnclosure(after) && !after.isBlock) {
    anchors.push({
      side: "before",
      nodeStart: sel.from,
      contentSize: after.content.size,
    });
  }
  return anchors;
}

/**
 * First line of defense: collapse the DOM selection into the adjacent text
 * node, so WKWebView's ambiguous boundary position can't pull the preedit
 * inside. Only the DOM selection is touched, which is composition-safe.
 */
export function pinDomCaretForComposition(
  view: EditorView,
  anchors: CompositionAnchor[],
): void {
  if (anchors.length !== 1) return; // caret between two enclosures - no text node to anchor into
  const bias = anchors[0].side === "after" ? 1 : -1; // lean away from the enclosure
  const sel = view.state.selection;
  let domPos: { node: globalThis.Node; offset: number };
  try {
    domPos = view.domAtPos(sel.from, bias);
  } catch {
    return;
  }
  if (domPos.node.nodeType !== Node.TEXT_NODE) return; // only a real text position is unambiguous
  const root = view.root as {
    getSelection?: () => globalThis.Selection | null;
  };
  const domSel = root.getSelection ? root.getSelection() : null;
  if (!domSel) return;
  try {
    domSel.collapse(domPos.node, domPos.offset);
  } catch {
    /* leave the fallback relocation to handle it */
  }
}

export function relocateComposedText(
  view: EditorView,
  anchors: CompositionAnchor[],
): void {
  const { state } = view;
  const sel = state.selection;
  if (!sel.empty) return;
  const $pos = sel.$from;
  const parent = $pos.parent;
  if (!isEnclosureName(parent.type.name)) return; // the text landed where the caret was - nothing to do
  const nodeStart = $pos.before($pos.depth);

  for (const anchor of anchors) {
    if (anchor.nodeStart !== nodeStart) continue;
    const grown = parent.content.size - anchor.contentSize;
    if (grown <= 0) continue;
    const contentStart = nodeStart + 1;

    if (anchor.side === "after") {
      // Committed text is the tail of the content, caret right after it.
      const from = contentStart + anchor.contentSize;
      const to = contentStart + parent.content.size;
      if (sel.from !== to) continue;
      const text = parent.textBetween(anchor.contentSize, parent.content.size);
      if (text.length !== grown) continue; // non-text content appeared - don't guess
      const tr = state.tr.delete(from, to);
      const insertAt = nodeStart + parent.nodeSize - grown; // right after the shrunk node
      tr.insertText(text, insertAt);
      tr.setSelection(TextSelection.create(tr.doc, insertAt + text.length));
      view.dispatch(tr);
    } else {
      // Mirror case: text got prepended to the content.
      const to = contentStart + grown;
      if (sel.from !== to) continue;
      const text = parent.textBetween(0, grown);
      if (text.length !== grown) continue;
      const tr = state.tr.delete(contentStart, to);
      tr.insertText(text, nodeStart);
      tr.setSelection(TextSelection.create(tr.doc, nodeStart + text.length));
      view.dispatch(tr);
    }
    return;
  }
}

/** How long after compositionend the committed text is moved out of an
 *  adjacent node. The md-span autopair waits a little longer. */
export const COMPOSE_RELOCATE_DELAY_MS = 30;
