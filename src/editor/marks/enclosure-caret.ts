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
 * state, and the moves and deletes of enclosure-moves.ts applied to the
 * view - including text an IME composed next to an enclosure, moved where
 * the writer meant it (enclosure.ts).
 */

export function setCaret(view: EditorView, pos: number): void {
  view.dispatch(
    view.state.tr.setSelection(TextSelection.create(view.state.doc, pos)),
  );
}

/**
 * Collapse the transaction's selection to `pos` (resolved against the
 * transaction's own, post-edit doc). Every enclosure-creating edit places
 * the caret through this, keeping the placement convention in one place:
 *   - opening a fresh empty shell         -> inside, at content start
 *   - completing a pair around content
 *     (forward pairing, Cmd+B on a caret) -> inside, at content start
 *   - closing/converting behind the caret
 *     (findRunOpen, typing the closer)    -> after the node
 *   - wrapping a selection                -> after the node
 */
export function caretAt(tr: Transaction, pos: number): Transaction {
  return tr.setSelection(TextSelection.create(tr.doc, pos));
}

/**
 * Where the browser's caret is, as a document position: null when the DOM
 * selection isn't a caret (none, or a range) or isn't at a position the
 * editor knows. See stateWithLiveSelection for why the state's own can lag.
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
    // -1 for a caret in DOM the document doesn't own (a revision's
    // widget): resolving it threw in link-reveal's liveSelection.
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
 * The editor state's selection can lag behind the real DOM caret: native
 * caret movement (the in-content steps deliberately left to the browser)
 * only reaches ProseMirror through an asynchronous selectionchange
 * readback, so a keystroke arriving shortly after one - key repeat, fast
 * arrowing - runs against a state.selection that's one or more steps
 * behind where the caret actually sits. prosemirror-view's own keydown
 * path has the same gap (its forceFlush only runs flushes that are
 * already scheduled). Every decision this plugin makes is position math
 * around the caret, so a stale position makes a boundary crossing that
 * should have been intercepted silently fall through to native movement -
 * which is exactly the movement that misbehaves next to the delimiter
 * widgets. This reads the caret straight out of the DOM and, when it
 * disagrees with the state, returns a state whose selection is corrected
 * to match.
 */
export function stateWithLiveSelection(view: EditorView): EditorState {
  const { state } = view;
  // A range the browser has but the state doesn't yet, or not all of -
  // Shift+Arrow just before Mod+B, the last steps still to be read back:
  // the shortcut wraps what is on screen selected. A node selection (an
  // image) is the state's own.
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
 * Delete one of a node's delimiters: the wrapper is no longer closed, so
 * the node unwraps into literal text that still carries the delimiter that
 * was NOT deleted ("*hello*" minus its closer -> literal "*hello"). Inner
 * nodes in the content survive as nodes. Retyping the deleted delimiter
 * re-forms the enclosure via the autopair plugins' findRunOpen path.
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
 * IME counterpart to redirectMisattributedInput. The same WKWebView caret
 * normalization that pulls plain keystrokes into an adjacent enclosure also
 * pulls IME composition text in - but during composition nothing may
 * dispatch (it would abort the preedit and commit the raw pinyin, see
 * redirectMisattributedInput's guard). So the fix runs bracketed around the
 * composition instead: at compositionstart, snapshot any enclosure the
 * caret sits directly against; after compositionend, if the committed text
 * ended up inside that node, move it back out to where the caret actually
 * was. Every check below bails silently when the doc doesn't match the
 * snapshot exactly - a missed relocation is far better than mangling text.
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
  // Composing inside code or maths stays there. Inside bold, text pulled
  // into the code beside the caret goes back out, as in a paragraph:
  // `**a `b`|**`.
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
 * First line of defense, before the relocation fallback below: give WKWebView
 * an unambiguous DOM caret position OUTSIDE the enclosure before the IME
 * inserts anything. The normalization that pulls the preedit inside happens
 * because the boundary position (between the delimiter widget and the
 * neighboring text) is ambiguous; collapsing the DOM selection into the
 * adjacent TEXT node at the same document position removes the ambiguity, so
 * the whole composition renders in the paragraph from the first keystroke -
 * no mid-composition bold styling, no post-commit relocation jump. Touching
 * only the DOM selection is composition-safe: nothing is dispatched and no
 * DOM is redrawn.
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
 *  adjacent node (relocateComposedText, in compositionend below).
 *  md-span-autopair-plugin.ts waits a little longer, to look after it. */
export const COMPOSE_RELOCATE_DELAY_MS = 30;
