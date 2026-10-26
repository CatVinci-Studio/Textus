import { Plugin, PluginKey } from "@milkdown/kit/prose/state";
import { TextSelection } from "@milkdown/kit/prose/state";
import { liftTarget } from "@milkdown/kit/prose/transform";
import { $prose } from "@milkdown/kit/utils";
import { isInTable, selectedRect } from "@milkdown/kit/prose/tables";
import { isImeKeyEvent, stateWithLiveSelection } from "../marks/enclosure";
import type { Node, ResolvedPos } from "@milkdown/kit/prose/model";
import type { EditorView } from "@milkdown/kit/prose/view";

// Blocks Enter stays inside, so the arrows are the only way out at an end.
const ESCAPABLE_BLOCK_TYPES = new Set([
  "code_block",
  "math_block",
  "frontmatter",
]);

function isLastTopLevelNode($from: ResolvedPos, doc: Node): boolean {
  if ($from.depth < 1) return false;
  const topPos = $from.before(1);
  const topNode = $from.node(1);
  return topPos + topNode.nodeSize === doc.content.size;
}

function isFirstTopLevelNode($from: ResolvedPos): boolean {
  return $from.depth >= 1 && $from.index(0) === 0;
}

// True only when every ancestor level is also the first child of its parent.
function hasNothingBefore($pos: ResolvedPos): boolean {
  for (let d = 0; d < $pos.depth; d++) {
    if ($pos.index(d) > 0) return false;
  }
  return true;
}

/**
 * The empty paragraph an escape adds, while nothing is typed in it. Left
 * empty it goes again, so moving through a document never changes the file.
 * Neither its coming nor its going is an undo step.
 */
const escapeLineKey = new PluginKey<number | null>("escape-line");

function escapeAfterLastNode(view: EditorView): boolean {
  const { state } = view;
  const paragraph = state.schema.nodes.paragraph.create();
  const insertPos = state.doc.content.size;
  const tr = state.tr.insert(insertPos, paragraph);
  tr.setSelection(TextSelection.near(tr.doc.resolve(tr.doc.content.size - 1)));
  tr.setMeta(escapeLineKey, insertPos).setMeta("addToHistory", false);
  view.dispatch(tr);
  view.focus();
  return true;
}

function escapeBeforeFirstNode(view: EditorView): boolean {
  const { state } = view;
  const paragraph = state.schema.nodes.paragraph.create();
  const tr = state.tr.insert(0, paragraph);
  tr.setSelection(TextSelection.near(tr.doc.resolve(1)));
  tr.setMeta(escapeLineKey, 0).setMeta("addToHistory", false);
  view.dispatch(tr);
  view.focus();
  return true;
}

/** The escape line at `pos`, if it is still there and still empty. */
function emptyEscapeLine(doc: Node, pos: number): Node | null {
  if (pos < 0 || pos >= doc.content.size) return null;
  const node = doc.nodeAt(pos);
  return node?.type.name === "paragraph" && node.content.size === 0
    ? node
    : null;
}

/**
 * An empty code block first in the doc has nothing to merge into, so
 * backspace would do nothing; it becomes a paragraph instead.
 */
function backspaceOutOfLeadingEmptyCodeBlock(view: EditorView): boolean {
  const { state } = view;
  const { $from, empty } = state.selection;
  if (!empty) return false;
  if ($from.parent.type.name !== "code_block") return false;
  if ($from.parentOffset !== 0 || $from.parent.content.size !== 0) return false;
  if (!hasNothingBefore($from)) return false;

  const paragraphType = state.schema.nodes.paragraph;
  const pos = $from.before($from.depth);
  const tr = state.tr.setNodeMarkup(pos, paragraphType);
  tr.setSelection(TextSelection.near(tr.doc.resolve(pos + 1)));
  view.dispatch(tr);
  return true;
}

/**
 * Backspace at the start of a line inside a blockquote takes that line out
 * of the quote; the default join has nothing sensible to merge it into.
 */
function backspaceOutOfBlockquote(view: EditorView): boolean {
  const { state } = view;
  const { $from, empty } = state.selection;
  if (!empty || $from.parentOffset !== 0 || $from.depth < 2) return false;
  if ($from.node($from.depth - 1).type.name !== "blockquote") return false;
  const range = $from.blockRange();
  const target = range && liftTarget(range);
  if (range == null || target == null) return false;
  view.dispatch(state.tr.lift(range, target).scrollIntoView());
  return true;
}

/**
 * A code or math block at the very start or end of the document traps the
 * arrow keys, so an escape line is added there on demand.
 */
export function createEscapeTrailingBlockPlugin() {
  return new Plugin<number | null>({
    key: escapeLineKey,
    state: {
      init: () => null,
      apply(tr, pos) {
        const set = tr.getMeta(escapeLineKey) as number | null | undefined;
        if (set !== undefined) return set;
        if (pos == null) return null;
        const mapped = tr.mapping.mapResult(pos, 1);
        if (mapped.deleted) return null;
        // Typed in: an ordinary line now.
        return emptyEscapeLine(tr.doc, mapped.pos) ? mapped.pos : null;
      },
    },
    appendTransaction(_trs, _old, state) {
      const pos = escapeLineKey.getState(state);
      if (pos == null) return null;
      const line = emptyEscapeLine(state.doc, pos);
      if (!line) return null;
      const { from, to } = state.selection;
      if (from >= pos && to <= pos + line.nodeSize) return null;
      // The doc keeps at least one block.
      if (state.doc.childCount === 1) return null;
      return state.tr
        .delete(pos, pos + line.nodeSize)
        .setMeta(escapeLineKey, null)
        .setMeta("addToHistory", false);
    },
    props: {
      handleKeyDown(view, event) {
        if (isImeKeyEvent(view, event)) return false;
        // Modified arrows navigate/select; they must never insert paragraphs.
        if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey)
          return false;
        if (event.key === "Backspace") {
          return (
            backspaceOutOfLeadingEmptyCodeBlock(view) ||
            backspaceOutOfBlockquote(view)
          );
        }

        const isForwardKey =
          event.key === "ArrowDown" || event.key === "ArrowRight";
        const isBackwardKey =
          event.key === "ArrowUp" || event.key === "ArrowLeft";
        if (!isForwardKey && !isBackwardKey) return false;

        const { state } = view;
        const { $from, empty } = state.selection;
        if (!empty) return false;

        const inEscapableBlock = ESCAPABLE_BLOCK_TYPES.has(
          $from.parent.type.name,
        );
        const inTable = isInTable(state);

        if (!inEscapableBlock && !inTable) return false;

        if (inEscapableBlock) {
          if (isBackwardKey) {
            if (!isFirstTopLevelNode($from)) return false;
            if ($from.parentOffset !== 0) return false;
            return escapeBeforeFirstNode(view);
          }

          if (!isLastTopLevelNode($from, state.doc)) return false;
          const atEndOfBlock = $from.parentOffset === $from.parent.content.size;
          if (!atEndOfBlock) return false;
          return escapeAfterLastNode(view);
        }

        // Tables: tableEdgeArrowPlugin, which has to run first.
        return false;
      },
    },
  });
}

/**
 * Up off a table's first row, or down off its last, where the table starts
 * or ends the document: a new paragraph there. prosemirror-tables would put
 * the caret back in a cell, so this is registered ahead of it.
 */
export function createTableEdgeArrowPlugin() {
  return new Plugin({
    props: {
      handleKeyDown(view, event) {
        if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return false;
        if (isImeKeyEvent(view, event)) return false;
        if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey)
          return false;
        const state = stateWithLiveSelection(view);
        const { $from, empty } = state.selection;
        if (!empty || !isInTable(state)) return false;
        const rect = selectedRect(state);
        if (event.key === "ArrowUp") {
          if (rect.top !== 0 || !isFirstTopLevelNode($from)) return false;
          if (!view.endOfTextblock("up")) return false;
          return escapeBeforeFirstNode(view);
        }
        if (rect.bottom !== rect.map.height) return false;
        if (!isLastTopLevelNode($from, state.doc)) return false;
        if (!view.endOfTextblock("down")) return false;
        return escapeAfterLastNode(view);
      },
    },
  });
}

export const tableEdgeArrowPlugin = $prose(createTableEdgeArrowPlugin);

export const escapeTrailingBlockPlugin = $prose(
  createEscapeTrailingBlockPlugin,
);
