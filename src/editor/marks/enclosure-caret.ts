import { TextSelection } from "@milkdown/kit/prose/state";
import { Fragment } from "@milkdown/kit/prose/model";
import type { EditorState } from "@milkdown/kit/prose/state";
import type { Node as ProseNode } from "@milkdown/kit/prose/model";
import type { EditorView } from "@milkdown/kit/prose/view";
import {
  enclosureDelims,
  isEnclosure,
  isEnclosureName,
} from "./enclosure-runs";
import type { DeleteAction } from "./enclosure-moves";

/** The enclosure deletes, and keeping a composition at the caret beside an
 *  enclosure, applied to the view. */

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
