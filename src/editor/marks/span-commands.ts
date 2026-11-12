import {
  TextSelection,
  type EditorState,
  type Transaction,
} from "@milkdown/kit/prose/state";
import type { EditorView } from "@milkdown/kit/prose/view";
import { LINK } from "../markdown/link-source";
import { parseLink } from "../markdown/link-syntax";

/**
 * Bold or italic on a selection in a link's label: its delimiters typed
 * around it, or taken off when they are already there. Null outside one.
 */
export function wrapInLinkSource(
  state: EditorState,
  delim: string,
): Transaction | null {
  const { $from, $to, from, to, empty } = state.selection;
  if (empty || $from.parent.type.name !== LINK || !$from.sameParent($to))
    return null;
  const text = $from.parent.textContent;
  const start = $from.parentOffset;
  const end = $to.parentOffset;
  // In the URL, delimiters would change where it points.
  const label = parseLink(text)?.label;
  if (!label || start < label[0] || end > label[1]) return null;
  const n = delim.length;
  const tr = state.tr;
  if (
    text.slice(start - n, start) === delim &&
    text.slice(end, end + n) === delim
  )
    tr.delete(to, to + n).delete(from - n, from);
  else tr.insertText(delim, to).insertText(delim, from);
  const shift = tr.mapping.map(from) - from;
  return tr.setSelection(
    TextSelection.create(tr.doc, from + shift, to + shift),
  );
}

/** Clear Formatting: every span the selection touches (bold, italic,
 *  strikethrough, highlight) taken off, its words kept. False with nothing
 *  to clear. */
export function clearSpans(view: EditorView): boolean {
  const { state } = view;
  const { from, to, empty } = state.selection;
  const spanType = state.schema.nodes.md_span;
  if (empty || !spanType) return false;
  const starts: number[] = [];
  state.doc.nodesBetween(from, to, (node, pos) => {
    if (node.type === spanType) starts.push(pos);
  });
  if (starts.length === 0) return false;
  const tr = state.tr;
  // Inner spans first, so each outer one is unwrapped as it now stands.
  for (const start of starts.reverse()) {
    const at = tr.mapping.map(start);
    const span = tr.doc.nodeAt(at);
    if (span?.type === spanType)
      tr.replaceWith(at, at + span.nodeSize, span.content);
  }
  view.dispatch(
    tr.setSelection(
      TextSelection.create(tr.doc, tr.mapping.map(from), tr.mapping.map(to)),
    ),
  );
  return true;
}
