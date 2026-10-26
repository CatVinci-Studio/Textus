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

// Nesting-safe version of isFirstTopLevelNode: true only when every
// ancestor level (list item within its list, list within the doc, etc.) is
// also the first child of its own parent.
function hasNothingBefore($pos: ResolvedPos): boolean {
  for (let d = 0; d < $pos.depth; d++) {
    if ($pos.index(d) > 0) return false;
  }
  return true;
}

/**
 * The empty paragraph an escape below adds, while nothing has been typed in
 * it: only somewhere for the caret to stand. Once the caret leaves it still
 * empty it goes again, so moving through a document never changes the file
 * (#350). Neither its coming nor its going is an undo step.
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
 * ProseMirror's default backspace-at-start-of-block handling merges into
 * the previous block, but an empty code block with nothing before it (the
 * very first node in the doc) has nothing to merge into, so backspace does
 * nothing and it's stuck. Fall back to converting it into a paragraph,
 * same as backspacing an empty heading/blockquote normally would.
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
 * Backspace at the start of a quote's first line takes that line out of
 * the quote, as every editor does. Without this it did nothing at all: the
 * default join has nothing sensible to merge the line into (an empty quote
 * at the top of the document was impossible to remove), so the quote could
 * only be got rid of by selecting around it. A later line joins the one
 * above it, as the default join does.
 */
function backspaceOutOfBlockquote(view: EditorView): boolean {
  const { state } = view;
  const { $from, empty } = state.selection;
  if (!empty || $from.parentOffset !== 0 || $from.depth < 2) return false;
  if ($from.node($from.depth - 1).type.name !== "blockquote") return false;
  if ($from.index($from.depth - 1) > 0) return false;
  const range = $from.blockRange();
  const target = range && liftTarget(range);
  if (range == null || target == null) return false;
  view.dispatch(state.tr.lift(range, target).scrollIntoView());
  return true;
}

/**
 * A code block or math block (tables: tableEdgeArrowPlugin below) at the
 * very start or end of the
 * document has nothing before/after it to move a cursor into - normal
 * arrow-key navigation can't escape it in that direction, and gets stuck.
 * This adds a trailing/leading empty paragraph on demand so there's always
 * somewhere to land - an escape line, gone again if left empty.
 *
 * A plain first or last line has no such gap: Enter at its start or end
 * makes a new line there, so the arrows only move.
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

        // Enter leaves code/math blocks and tables in block-keys-plugin.ts.
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
 * or ends the document: a new paragraph there, from any cell, as for code
 * blocks above. prosemirror-tables takes these keys first and, finding no
 * line beyond the table, put the caret back in its first or last cell -
 * the next cell along instead of a line up or down - so this plugin is
 * registered ahead of the table plugin (editor-extensions.ts).
 */
export function createTableEdgeArrowPlugin() {
  return new Plugin({
    props: {
      handleKeyDown(view, event) {
        if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return false;
        if (isImeKeyEvent(view, event)) return false;
        if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey)
          return false;
        // The caret a click or fast arrowing has just moved
        // (enclosure.ts's stateWithLiveSelection).
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
