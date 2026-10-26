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

// The same md_span shells the autopair plugin opens for typed delimiters.
const SHORTCUTS: Record<string, FormatSpec> = {
  b: { delim: "*", rung: 2 },
  i: { delim: "*", rung: 1 },
};

/** Inline nodes besides text a selection may hold to be made bold or
 *  italic: verbatim ones, with no formatting of their own to clash. */
const WRAPPABLE = new Set(["md_code_span", "math_inline"]);

/**
 * The shortcut pressed again on its own formatting takes it off; a `***`
 * span keeps the other half. Null when the selection isn't in or on such a
 * span.
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
    return tr.setSelection(
      TextSelection.create(tr.doc, from - shift, Math.max(from, to) - shift),
    );
  };
  for (let d = $from.depth; d > 0; d--) {
    const node = $from.node(d);
    if ($to.depth < d || $to.node(d) !== node) break;
    if (!matches(node)) continue;
    // The caret at the end of what was just typed bold: the press ends the bold
    // and typing goes on after it, as in Typora.
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

/** The `*` span the selection covers all of, and its position; null
 *  otherwise. */
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
 * Cmd/Ctrl+B and Cmd/Ctrl+I on md_span nodes (the schema has no strong/em
 * marks). No selection opens an empty shell, as typing "**" does; a
 * selection in one textblock is wrapped, edge whitespace left outside so it
 * serializes; inside code/math or another shell, nothing.
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

          // Live selection: Cmd+B right after fast caret movement must not act on a
          // position one step behind.
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

          if (!(state.selection instanceof TextSelection)) return false;
          if (!$from.sameParent($to)) return false;

          // All of a bold span selected, Mod+I makes it one `***` span, and the
          // other way round.
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

          // Only a text node's edge whitespace stays outside: spaces in code are code.
          const selected = parent.content.cut(
            $from.parentOffset,
            $to.parentOffset,
          );
          const edgeSpaces = (node: ProseNode | null, pattern: RegExp) =>
            node?.isText ? pattern.exec(node.text!)![0].length : 0;
          const from = $from.pos + edgeSpaces(selected.firstChild, /^\s*/);
          const to = $to.pos - edgeSpaces(selected.lastChild, /\s*$/);
          if (from >= to) return false;

          // Text, code and maths may move inside; a span already in the selection
          // leaves it alone.
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
          // The text stays selected, as in Typora.
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
