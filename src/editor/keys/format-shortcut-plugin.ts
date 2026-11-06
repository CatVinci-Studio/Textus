import {
  Plugin,
  TextSelection,
  type EditorState,
  type Transaction,
} from "@milkdown/kit/prose/state";
import type { Node as ProseNode } from "@milkdown/kit/prose/model";
import type { EditorView } from "@milkdown/kit/prose/view";
import { $prose } from "@milkdown/kit/utils";
import { isEnclosureName } from "../marks/enclosure";
import { wrapInLinkSource } from "../marks/span-commands";
import { caretAt, stateWithLiveSelection } from "../live-selection";
import { isImeKeyEvent } from "./ime";
import { LINK } from "../markdown/link-source";

export interface FormatSpec {
  delim: string;
  rung: number;
}

// The same md_span shells the autopair plugin opens for typed delimiters.
const SHORTCUTS: Record<string, FormatSpec> = {
  b: { delim: "*", rung: 2 },
  i: { delim: "*", rung: 1 },
};
/** Highlight, `==text==`: Format › Highlight and Cmd/Ctrl+Shift+H, as in
 *  Typora. */
export const HIGHLIGHT: FormatSpec = { delim: "=", rung: 2 };
const SHIFT_SHORTCUTS: Record<string, FormatSpec> = { h: HIGHLIGHT };
/** Strikethrough, `~~text~~`: Format › Strikethrough and Ctrl+Shift+`. */
export const STRIKETHROUGH: FormatSpec = { delim: "~", rung: 2 };

/** Inline nodes besides text a selection may hold to be made bold or
 *  italic: verbatim ones, with no formatting of their own to clash. */
const WRAPPABLE = new Set(["md_code_span", "math_inline", LINK]);

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

/** What of each textblock a selection over several holds, trimmed of edge
 *  whitespace: the ranges a shortcut wraps or unwraps. Code, maths and
 *  enclosure blocks are left out. */
function blockRanges(state: EditorState): { from: number; to: number }[] {
  const { from, to } = state.selection;
  const ranges: { from: number; to: number }[] = [];
  state.doc.nodesBetween(from, to, (node, pos) => {
    if (!node.isTextblock) return true;
    if (node.type.spec.code || isEnclosureName(node.type.name)) return false;
    const start = Math.max(from, pos + 1);
    const end = Math.min(to, pos + 1 + node.content.size);
    // Only a text node's edge whitespace stays outside: spaces in code are code.
    const part = state.doc.slice(start, end).content;
    const edge = (child: ProseNode | null, pattern: RegExp) =>
      child?.isText ? pattern.exec(child.text!)![0].length : 0;
    const lead = edge(part.firstChild, /^\s*/);
    const trail = edge(part.lastChild, /\s*$/);
    if (start + lead < end - trail)
      ranges.push({ from: start + lead, to: end - trail });
    return false;
  });
  return ranges;
}

/**
 * A selection over several textblocks: each block's part made bold or
 * italic on its own, as in Typora, or, when every part already is, each
 * taken off. One step to undo. Null when a part holds what can't be wrapped.
 */
function acrossBlocks(
  state: EditorState,
  spec: FormatSpec,
): Transaction | null {
  const ranges = blockRanges(state);
  if (ranges.length === 0) return null;
  const spanOf = ({ from, to }: { from: number; to: number }) => {
    const node = state.doc.nodeAt(from);
    return node?.type.name === "md_span" &&
      node.attrs.delim === spec.delim &&
      node.attrs.rung === spec.rung &&
      from + node.nodeSize === to
      ? node
      : null;
  };
  const tr = state.tr;
  const allOn = ranges.every((range) => spanOf(range));
  for (const range of [...ranges].reverse()) {
    if (allOn) {
      tr.replaceWith(range.from, range.to, spanOf(range)!.content);
      continue;
    }
    if (spanOf(range)) continue;
    const fragment = state.doc.slice(range.from, range.to).content;
    for (let i = 0; i < fragment.childCount; i++) {
      const child = fragment.child(i);
      if (!child.isText && !WRAPPABLE.has(child.type.name)) return null;
    }
    tr.replaceWith(
      range.from,
      range.to,
      state.schema.nodes.md_span.create(
        { delim: spec.delim, rung: spec.rung },
        fragment,
      ),
    );
  }
  const { from, to } = state.selection;
  return tr.setSelection(
    TextSelection.create(tr.doc, tr.mapping.map(from, -1), tr.mapping.map(to)),
  );
}

/**
 * One of these md_span styles (the schema has no strong/em marks) toggled
 * on the selection. No selection opens an empty shell, as typing "**" does;
 * a selection in one textblock is wrapped, edge whitespace left outside so
 * it serializes; one over several textblocks, each block's part; inside
 * code/math or another shell, nothing. False where nothing applies.
 */
export function toggleFormat(view: EditorView, spec: FormatSpec): boolean {
  // Live selection: Cmd+B right after fast caret movement must not act on a
  // position one step behind.
  const state = stateWithLiveSelection(view);
  const off =
    toggleOff(state, spec) ??
    wrapInLinkSource(state, spec.delim.repeat(spec.rung));
  if (off) {
    view.dispatch(off);
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
    return true;
  }

  // Over several blocks, or all of the document (Select All).
  if (!$from.sameParent($to) || !parent.inlineContent) {
    const tr = acrossBlocks(state, spec);
    if (!tr) return false;
    view.dispatch(tr);
    return true;
  }
  if (!(state.selection instanceof TextSelection)) return false;

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
    return true;
  }
  if (
    !parent.isTextblock ||
    parent.type.spec.code ||
    isEnclosureName(parent.type.name)
  )
    return false;

  // Only a text node's edge whitespace stays outside: spaces in code are code.
  const selected = parent.content.cut($from.parentOffset, $to.parentOffset);
  const edgeSpaces = (node: ProseNode | null, pattern: RegExp) =>
    node?.isText ? pattern.exec(node.text!)![0].length : 0;
  const from = $from.pos + edgeSpaces(selected.firstChild, /^\s*/);
  const to = $to.pos - edgeSpaces(selected.lastChild, /\s*$/);
  if (from >= to) return false;

  // Text, code and maths may move inside; a span already in the selection
  // leaves it alone.
  const fragment = parent.content.cut(from - $from.start(), to - $from.start());
  for (let i = 0; i < fragment.childCount; i++) {
    const child = fragment.child(i);
    if (!child.isText && !WRAPPABLE.has(child.type.name)) return false;
  }

  const node = mdSpan.create({ delim: spec.delim, rung: spec.rung }, fragment);
  // The text stays selected, as in Typora.
  const tr = state.tr.replaceWith(from, to, node);
  tr.setSelection(
    TextSelection.create(tr.doc, from + 1, from + 1 + fragment.size),
  );
  view.dispatch(tr);
  return true;
}

/** The selection in one textblock as plain text, or null where it holds
 *  more than text or sits in code. */
function plainSelection(state: EditorState) {
  const { $from, $to } = state.selection;
  const parent = $from.parent;
  if (
    !$from.sameParent($to) ||
    !parent.isTextblock ||
    parent.type.spec.code ||
    isEnclosureName(parent.type.name)
  )
    return null;
  const part = parent.content.cut($from.parentOffset, $to.parentOffset);
  let plain = true;
  part.forEach((child) => (plain &&= child.isText));
  return plain ? state.doc.textBetween($from.pos, $to.pos) : null;
}

/** Inline code, Ctrl+`: the selection made code, an empty one opened as
 *  typing "`" does, and the caret in code taking it off. */
export function toggleCodeSpan(view: EditorView): boolean {
  const state = stateWithLiveSelection(view);
  const code = state.schema.nodes.md_code_span;
  const { $from, from, to, empty } = state.selection;
  if (!code) return false;
  if ($from.parent.type === code) {
    const start = $from.before();
    const tr = state.tr.replaceWith(start, $from.after(), $from.parent.content);
    view.dispatch(caretAt(tr, from - 1));
    return true;
  }
  const text = plainSelection(state);
  if (text === null) return false;
  const node = code.create({}, text ? state.schema.text(text) : undefined);
  const tr = state.tr.replaceWith(from, to, node);
  view.dispatch(
    empty
      ? caretAt(tr, from + 1)
      : tr.setSelection(
          TextSelection.create(tr.doc, from + 1, from + 1 + text.length),
        ),
  );
  return true;
}

/** Cmd/Ctrl+K: `[selection]()` with the caret where the address goes - or,
 *  with nothing selected, where its text goes. It becomes a link once filled
 *  in, as one typed out does. */
export function insertLink(view: EditorView): boolean {
  const state = stateWithLiveSelection(view);
  const text = plainSelection(state);
  if (text === null) return false;
  const { from, to } = state.selection;
  const tr = state.tr.insertText(`[${text}]()`, from, to);
  view.dispatch(caretAt(tr, from + (text ? text.length + 3 : 1)));
  return true;
}

/** Ctrl+` and Ctrl+Shift+` by the key itself: the shifted character
 *  differs between layouts. Control on a Mac too, where Cmd+` is the
 *  system's. */
function backquoteKey(event: KeyboardEvent): boolean {
  return (
    (event.code === "Backquote" || event.key === "`") &&
    event.ctrlKey &&
    !event.metaKey &&
    !event.altKey
  );
}

/** Cmd/Ctrl+B, Cmd/Ctrl+I and Cmd/Ctrl+Shift+H; Cmd/Ctrl+K, Ctrl+` and
 *  Ctrl+Shift+`. */
export const formatShortcutPlugin = $prose(
  () =>
    new Plugin({
      props: {
        handleKeyDown(view, event) {
          if (backquoteKey(event)) {
            if (isImeKeyEvent(view, event)) return false;
            const done = event.shiftKey
              ? toggleFormat(view, STRIKETHROUGH)
              : toggleCodeSpan(view);
            if (done) event.preventDefault();
            return done;
          }
          if (!(event.metaKey || event.ctrlKey) || event.altKey) return false;
          if (event.key.toLowerCase() === "k" && !event.shiftKey) {
            if (isImeKeyEvent(view, event) || !insertLink(view)) return false;
            event.preventDefault();
            return true;
          }
          const spec = (event.shiftKey ? SHIFT_SHORTCUTS : SHORTCUTS)[
            event.key.toLowerCase()
          ];
          if (!spec) return false;
          if (isImeKeyEvent(view, event)) return false;
          if (!toggleFormat(view, spec)) return false;
          event.preventDefault();
          return true;
        },
      },
    }),
);
