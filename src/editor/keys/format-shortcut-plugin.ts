import {
  Plugin,
  TextSelection,
  type EditorState,
  type Transaction,
} from "@milkdown/kit/prose/state";
import type { Node as ProseNode } from "@milkdown/kit/prose/model";
import { $prose } from "@milkdown/kit/utils";
import {
  caretAt,
  isEnclosureName,
  isImeKeyEvent,
  stateWithLiveSelection,
} from "../marks/enclosure";

interface FormatSpec {
  delim: string;
  rung: number;
}

// Mod+B = bold, Mod+I = italic - the same md_span shells the autopair
// plugin opens when the delimiters are typed by hand.
const SHORTCUTS: Record<string, FormatSpec> = {
  b: { delim: "*", rung: 2 },
  i: { delim: "*", rung: 1 },
};

/** Inline nodes besides text a selection may hold to be made bold or
 *  italic: verbatim ones, with no formatting of their own to clash. */
const WRAPPABLE = new Set(["md_code_span", "math_inline"]);

/**
 * The shortcut pressed again on its own formatting takes it off, as in
 * every editor: with the caret or the selection inside a bold span (or
 * the selection covering one), Cmd/Ctrl+B unwraps it back to text.
 * Bold-italic typed as one `***` span keeps the other half. Null when the
 * selection isn't in or on such a span.
 */
function toggleOff(state: EditorState, spec: FormatSpec): Transaction | null {
  const { $from, $to, from, to, empty } = state.selection;
  const matches = (node: ProseNode | null | undefined) =>
    node?.type.name === "md_span" &&
    node.attrs.delim === spec.delim &&
    (node.attrs.rung === spec.rung || node.attrs.rung === 3);
  const unwrap = (start: number, node: ProseNode, shift: number) => {
    if (node.attrs.rung === 3)
      return state.tr.setNodeMarkup(start, undefined, {
        delim: spec.delim,
        rung: 3 - spec.rung,
      });
    const tr = state.tr.replaceWith(start, start + node.nodeSize, node.content);
    // What was selected stays selected: the span's opening is gone from
    // before it.
    return tr.setSelection(
      TextSelection.create(tr.doc, from - shift, Math.max(from, to) - shift),
    );
  };
  for (let d = $from.depth; d > 0; d--) {
    const node = $from.node(d);
    if ($to.depth < d || $to.node(d) !== node) break;
    if (!matches(node)) continue;
    // The caret at the end of what was just typed bold: the press ends
    // the bold and the text goes on after it, as in Typora - not undo it.
    if (empty && node.content.size > 0 && from === $from.end(d))
      return state.tr.setSelection(
        TextSelection.create(state.doc, $from.after(d)),
      );
    return unwrap($from.before(d), node, 1);
  }
  // A selection from just before a span to just after it.
  if (!empty && $from.sameParent($to)) {
    const node = state.doc.nodeAt(from);
    if (matches(node) && from + node!.nodeSize === to) {
      const tr = unwrap(from, node!, 0);
      if (node!.attrs.rung === 3) return tr;
      return tr.setSelection(TextSelection.create(tr.doc, from, to - 2));
    }
  }
  return null;
}

/** The `*` span the selection covers all of - its text from end to end,
 *  or the span itself from just before to just after it - with its
 *  position; null otherwise. */
function wholeSpan(
  state: EditorState,
): { node: ProseNode; pos: number } | null {
  const { $from, $to, from, to, empty } = state.selection;
  if (empty || !$from.sameParent($to)) return null;
  const parent = $from.parent;
  if (
    parent.type.name === "md_span" &&
    $from.parentOffset === 0 &&
    $to.parentOffset === parent.content.size
  )
    return { node: parent, pos: $from.before() };
  const node = state.doc.nodeAt(from);
  if (node?.type.name === "md_span" && from + node.nodeSize === to)
    return { node, pos: from };
  return null;
}

/**
 * Cmd/Ctrl+B and Cmd/Ctrl+I, built on the same md_span nodes as typing the
 * delimiters (there are no strong/em marks in this schema - see
 * reduced-presets.ts, which strips the stock keymaps along with the marks):
 *
 * - With no selection: open an empty shell, cursor inside, exactly like
 *   typing "**" - and pressing the shortcut again while that shell is still
 *   empty removes it (toggleOff), so an accidental press undoes itself.
 * - With a selection of text (code and maths in it too) inside one
 *   textblock: wrap it in the shell (whitespace at the edges stays
 *   outside - delimiters hugging spaces wouldn't serialize to valid
 *   markdown).
 * - In or on a span of the same style: take it off (toggleOff).
 * - Inside code/math or another shell: do nothing, matching the
 *   autopair plugins' no-nesting rule.
 */
export const formatShortcutPlugin = $prose(
  () =>
    new Plugin({
      props: {
        handleKeyDown(view, event) {
          if (
            !(event.metaKey || event.ctrlKey) ||
            event.altKey ||
            event.shiftKey
          )
            return false;
          const spec = SHORTCUTS[event.key.toLowerCase()];
          if (!spec) return false;
          if (isImeKeyEvent(view, event)) return false;

          // Live selection: Cmd+B right after fast caret movement must not
          // act on a position one step behind (see stateWithLiveSelection).
          const state = stateWithLiveSelection(view);
          const off = toggleOff(state, spec);
          if (off) {
            view.dispatch(off);
            event.preventDefault();
            return true;
          }

          const mdSpan = state.schema.nodes.md_span;
          const { $from, $to, empty } = state.selection;
          const parent = $from.parent;

          if (empty) {
            if (
              !parent.isTextblock ||
              parent.type.spec.code ||
              isEnclosureName(parent.type.name)
            )
              return false;

            const node = mdSpan.create({ delim: spec.delim, rung: spec.rung });
            const tr = state.tr.replaceWith($from.pos, $from.pos, node);
            view.dispatch(caretAt(tr, $from.pos + 1));
            event.preventDefault();
            return true;
          }

          // Selection: wrap plain text within a single textblock.
          if (!(state.selection instanceof TextSelection)) return false;
          if (!$from.sameParent($to)) return false;

          // All of a bold span selected, Mod+I makes it bold-italic (one
          // `***` span), and the other way round; the selection stays.
          const whole = wholeSpan(state);
          if (
            whole &&
            whole.node.attrs.delim === spec.delim &&
            whole.node.attrs.rung === 3 - spec.rung
          ) {
            view.dispatch(
              state.tr.setNodeMarkup(whole.pos, undefined, {
                ...whole.node.attrs,
                rung: 3,
              }),
            );
            event.preventDefault();
            return true;
          }
          if (
            !parent.isTextblock ||
            parent.type.spec.code ||
            isEnclosureName(parent.type.name)
          )
            return false;

          // Keep edge whitespace outside the shell - only a text node's:
          // spaces inside code at an edge belong to the code.
          const selected = parent.content.cut(
            $from.parentOffset,
            $to.parentOffset,
          );
          const edgeSpaces = (node: ProseNode | null, pattern: RegExp) =>
            node?.isText ? pattern.exec(node.text!)![0].length : 0;
          const from = $from.pos + edgeSpaces(selected.firstChild, /^\s*/);
          const to = $to.pos - edgeSpaces(selected.lastChild, /\s*$/);
          if (from >= to) return false;

          // Text, code and maths may move inside: `**a `b` c**` is bold
          // around code. A span already in the selection is left alone -
          // bold in bold, or italic split by the new bold's edges.
          const fragment = parent.content.cut(
            from - $from.start(),
            to - $from.start(),
          );
          for (let i = 0; i < fragment.childCount; i++) {
            const child = fragment.child(i);
            if (!child.isText && !WRAPPABLE.has(child.type.name)) return false;
          }

          const node = mdSpan.create(
            { delim: spec.delim, rung: spec.rung },
            fragment,
          );
          // The text stays selected, as in Typora: Mod+I next makes it
          // bold-italic, Mod+B again takes the bold off.
          const tr = state.tr.replaceWith(from, to, node);
          tr.setSelection(
            TextSelection.create(tr.doc, from + 1, from + 1 + fragment.size),
          );
          view.dispatch(tr);
          event.preventDefault();
          return true;
        },
      },
    }),
);
