import {
  TextSelection,
  type EditorState,
  type Transaction,
} from "@milkdown/kit/prose/state";
import type { EditorView } from "@milkdown/kit/prose/view";
import { caretAt } from "../live-selection";
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

/**
 * Bold (rung 2) and italic (rung 1) for the iPhone keyboard toolbar. They
 * are md_span nodes, not marks, so toggleMark doesn't apply: unwrap a span
 * of this style, wrap a selection, or open an empty span at the caret.
 * False where none applies.
 */
export function toggleSpan(view: EditorView, rung: 1 | 2): boolean {
  const { state } = view;
  const { $from, $to, from, to, empty } = state.selection;
  const spanType = state.schema.nodes.md_span;
  if (!spanType) return false;

  // Unwrap: the selection sits in (or exactly covers) a span of this style.
  const parent = $from.parent;
  if (
    parent.type === spanType &&
    parent.attrs.delim === "*" &&
    parent.attrs.rung === rung &&
    $to.parent === parent
  ) {
    const start = $from.before();
    const tr = state.tr.replaceWith(start, $from.after(), parent.content);
    tr.setSelection(
      TextSelection.create(tr.doc, from - 1, Math.max(from - 1, to - 1)),
    );
    view.dispatch(tr);
    return true;
  }

  const inLink = wrapInLinkSource(state, "*".repeat(rung));
  if (inLink) {
    view.dispatch(inLink);
    return true;
  }
  if (!$from.sameParent($to) || !parent.inlineContent || parent.type.spec.code)
    return false;

  if (empty) {
    const tr = state.tr.replaceWith(
      from,
      to,
      spanType.create({ delim: "*", rung }),
    );
    view.dispatch(caretAt(tr, from + 1));
    return true;
  }

  const content = state.doc.slice(from, to).content;
  const node = spanType.create({ delim: "*", rung }, content);
  const tr = state.tr.replaceWith(from, to, node);
  tr.setSelection(
    TextSelection.create(tr.doc, from + 1, from + 1 + content.size),
  );
  view.dispatch(tr);
  return true;
}
