import { Plugin, TextSelection } from "@milkdown/kit/prose/state";
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
 * Cmd/Ctrl+B and Cmd/Ctrl+I, built on the same md_span nodes as typing the
 * delimiters (there are no strong/em marks in this schema - see
 * reduced-presets.ts, which strips the stock keymaps along with the marks):
 *
 * - With no selection: open an empty shell, cursor inside, exactly like
 *   typing "**" - and pressing the shortcut again while that shell is still
 *   empty removes it, so an accidental press undoes itself.
 * - With a selection of text (code and maths in it too) inside one
 *   textblock: wrap it in the shell (whitespace at the edges stays
 *   outside - delimiters hugging spaces wouldn't serialize to valid
 *   markdown).
 * - Inside code/math or an existing shell: do nothing, matching the
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
          const mdSpan = state.schema.nodes.md_span;
          const { $from, $to, empty } = state.selection;
          const parent = $from.parent;

          if (empty) {
            // Second press while the shell is still empty - take it back out.
            if (
              parent.type.name === "md_span" &&
              parent.content.size === 0 &&
              parent.attrs.delim === spec.delim &&
              parent.attrs.rung === spec.rung
            ) {
              const nodeStart = $from.before($from.depth);
              view.dispatch(
                state.tr.delete(nodeStart, nodeStart + parent.nodeSize),
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

            const node = mdSpan.create({ delim: spec.delim, rung: spec.rung });
            const tr = state.tr.replaceWith($from.pos, $from.pos, node);
            view.dispatch(caretAt(tr, $from.pos + 1));
            event.preventDefault();
            return true;
          }

          // Selection: wrap plain text within a single textblock.
          if (!(state.selection instanceof TextSelection)) return false;
          if (!$from.sameParent($to)) return false;
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
          const tr = state.tr.replaceWith(from, to, node);
          view.dispatch(caretAt(tr, from + node.nodeSize));
          event.preventDefault();
          return true;
        },
      },
    }),
);
