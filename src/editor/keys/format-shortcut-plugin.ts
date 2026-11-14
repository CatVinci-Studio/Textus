import {
  Plugin,
  TextSelection,
  type EditorState,
  type Transaction,
} from "@milkdown/kit/prose/state";
import type { Node as ProseNode } from "@milkdown/kit/prose/model";
import type { EditorView } from "@milkdown/kit/prose/view";
import { $prose } from "@milkdown/kit/utils";
import { isEnclosureName } from "../marks/enclosure-runs";
import { wrapInLinkSource } from "../marks/span-commands";
import { caretAt, stateWithLiveSelection } from "../live-selection";
import { isImeKeyEvent } from "./ime";
import { toggleCodeSpan } from "./code-toggle";

export { toggleCodeSpan };
import {
  blockRanges,
  gives,
  outAtEdges,
  mergedContent,
  outOfSpans,
  type FormatSpec,
} from "./format-merge";

/** Bold and italic: the same md_span shells the autopair plugin opens for
 *  typed delimiters. Every Bold and Italic (keys, menus, bars) goes
 *  through toggleFormat, which reads the selection where the browser has it. */
export const BOLD: FormatSpec = { delim: "*", rung: 2 };
export const ITALIC: FormatSpec = { delim: "*", rung: 1 };
const SHORTCUTS: Record<string, FormatSpec> = { b: BOLD, i: ITALIC };
/** Highlight, `==text==`: Format › Highlight and Cmd/Ctrl+Shift+H, as in
 *  Typora. */
export const HIGHLIGHT: FormatSpec = { delim: "=", rung: 2 };
const SHIFT_SHORTCUTS: Record<string, FormatSpec> = { h: HIGHLIGHT };
/** Strikethrough, `~~text~~`: Format › Strikethrough and Ctrl+Shift+`. */
export const STRIKETHROUGH: FormatSpec = { delim: "~", rung: 2 };

/**
 * The shortcut pressed again on its own formatting takes it off; a `***`
 * span keeps the other half. Null when the selection isn't in or on such a
 * span.
 */
function toggleOff(state: EditorState, spec: FormatSpec): Transaction | null {
  const { $from, $to, from, to, empty } = state.selection;
  const matches = (node: ProseNode | null | undefined) =>
    !!node && gives(node, spec);
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
  // A selection that is all of a span, either end inside it or just
  // outside: from before it to the end of its text, say.
  if (!empty) {
    const start = outAtEdges(state, from, -1);
    const end = outAtEdges(state, to, 1);
    const node = state.doc.nodeAt(start);
    if (matches(node) && start + node!.nodeSize === end) {
      const tr = unwrap(start, node!, 0);
      if (node!.attrs.rung === 3) return tr;
      return tr.setSelection(TextSelection.create(tr.doc, start, end - 2));
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
  // The span a block's part is all of, either end inside it or not.
  // `***` loads as italic around bold: the span looked for may be inside.
  const spanOf = (range: { from: number; to: number }) => {
    let from = outAtEdges(state, range.from, -1);
    const to = outAtEdges(state, range.to, 1);
    let node = state.doc.nodeAt(from);
    if (!node || from + node.nodeSize !== to) return null;
    while (!gives(node, spec) && node.childCount === 1) {
      const inner: ProseNode = node.firstChild!;
      if (inner.type.name !== "md_span") return null;
      node = inner;
      from += 1;
    }
    return gives(node, spec) ? { node, from, to: from + node.nodeSize } : null;
  };
  const tr = state.tr;
  const allOn = ranges.every((range) => spanOf(range));
  for (const range of [...ranges].reverse()) {
    const on = spanOf(range);
    if (allOn && on!.node.attrs.rung === 3)
      tr.setNodeMarkup(on!.from, undefined, {
        ...on!.node.attrs,
        rung: 3 - spec.rung,
      });
    else if (allOn) tr.replaceWith(on!.from, on!.to, on!.node.content);
    else if (!on && !wrapMerged(state, tr, range, spec)) return null;
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
  const { $from, empty } = state.selection;
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
  if (!sameTextblock(state) || !parent.inlineContent) {
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

  // Edge whitespace stays outside, so it serializes. Bold already in the
  // selection, or half in it, merges into the one new span.
  const [range] = blockRanges(state);
  const tr = state.tr;
  const span = range && wrapMerged(state, tr, range, spec);
  if (!span) return false;
  // The text stays selected, as in Typora.
  view.dispatch(
    tr.setSelection(
      TextSelection.create(tr.doc, span.from + 1, span.from + 1 + span.size),
    ),
  );
  return true;
}

/** Both ends of the selection in one textblock, at any depth of spans. */
function sameTextblock(state: EditorState): boolean {
  const { $from, $to } = state.selection;
  const block = (depth: number, $pos: typeof $from) => {
    for (let d = depth; d >= 0; d--)
      if ($pos.node(d).isTextblock) return $pos.before(d);
    return -1;
  };
  const at = block($from.depth, $from);
  return at >= 0 && at === block($to.depth, $to);
}

/**
 * `range` (in one textblock) wrapped in one `spec` span on `tr`, taking in
 * whole any `spec` span it cuts and flattening those inside. Where the new
 * span starts and its content's size; null when it can't be wrapped.
 */
function wrapMerged(
  state: EditorState,
  tr: Transaction,
  range: { from: number; to: number },
  spec: FormatSpec,
): { from: number; size: number } | null {
  const from = outOfSpans(state, range.from, -1, spec);
  const to = outOfSpans(state, range.to, 1, spec);
  const $from = state.doc.resolve(from);
  const parent = $from.parent;
  if (
    !$from.sameParent(state.doc.resolve(to)) ||
    !parent.isTextblock ||
    parent.type.spec.code ||
    isEnclosureName(parent.type.name)
  )
    return null;
  const content = mergedContent(state.doc.slice(from, to).content, spec);
  if (!content) return null;
  tr.replaceWith(
    tr.mapping.map(from),
    tr.mapping.map(to),
    state.schema.nodes.md_span.create(
      { delim: spec.delim, rung: spec.rung },
      content,
    ),
  );
  return { from: tr.mapping.map(from, -1), size: content.size };
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
          // Taken even where nothing applies: the browser's own bold would
          // write tags the editor has no mark for.
          toggleFormat(view, spec);
          event.preventDefault();
          return true;
        },
      },
    }),
);
