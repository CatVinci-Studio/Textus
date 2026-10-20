import { Plugin } from "@milkdown/kit/prose/state";
import { TextSelection } from "@milkdown/kit/prose/state";
import { liftTarget } from "@milkdown/kit/prose/transform";
import { $prose } from "@milkdown/kit/utils";
import { isInTable, selectedRect } from "@milkdown/kit/prose/tables";
import { isImeKeyEvent, stateWithLiveSelection } from "../marks/enclosure";
import type { Node, ResolvedPos } from "@milkdown/kit/prose/model";
import type { EditorView } from "@milkdown/kit/prose/view";

const ESCAPABLE_BLOCK_TYPES = new Set(["code_block", "math_block"]);

function isLastTopLevelNode($from: ResolvedPos, doc: Node): boolean {
  if ($from.depth < 1) return false;
  const topPos = $from.before(1);
  const topNode = $from.node(1);
  return topPos + topNode.nodeSize === doc.content.size;
}

function isFirstTopLevelNode($from: ResolvedPos): boolean {
  return $from.depth >= 1 && $from.index(0) === 0;
}

// Nesting-safe version of the two checks above: true only when every
// ancestor level (list item within its list, list within the doc, etc.) is
// also the last/first child of its own parent - so e.g. the last item of a
// list still correctly reports "nothing after" even though the list itself
// has siblings before it.
function hasNothingAfter($pos: ResolvedPos): boolean {
  for (let d = 0; d < $pos.depth; d++) {
    if ($pos.index(d) < $pos.node(d).childCount - 1) return false;
  }
  return true;
}

function hasNothingBefore($pos: ResolvedPos): boolean {
  for (let d = 0; d < $pos.depth; d++) {
    if ($pos.index(d) > 0) return false;
  }
  return true;
}

function escapeAfterLastNode(view: EditorView): boolean {
  const { state } = view;
  const paragraph = state.schema.nodes.paragraph.create();
  const insertPos = state.doc.content.size;
  const tr = state.tr.insert(insertPos, paragraph);
  tr.setSelection(TextSelection.near(tr.doc.resolve(tr.doc.content.size - 1)));
  view.dispatch(tr);
  view.focus();
  return true;
}

function escapeBeforeFirstNode(view: EditorView): boolean {
  const { state } = view;
  const paragraph = state.schema.nodes.paragraph.create();
  const tr = state.tr.insert(0, paragraph);
  tr.setSelection(TextSelection.near(tr.doc.resolve(1)));
  view.dispatch(tr);
  view.focus();
  return true;
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
 * Backspace at the start of a line inside a blockquote takes that line out
 * of the quote, as every editor does. Without this it did nothing at all:
 * the default join has nothing sensible to merge the line into (an empty
 * quote at the top of the document was impossible to remove), so the quote
 * could only be got rid of by selecting around it.
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
 * A code block or math block (tables: tableEdgeArrowPlugin below) at the
 * very start or end of the
 * document has nothing before/after it to move a cursor into - normal
 * arrow-key navigation can't escape it in that direction, and gets stuck.
 * This adds a trailing/leading empty paragraph on demand so there's always
 * somewhere to land.
 *
 * The same "nothing to land on" gap exists for a plain non-empty last/first
 * line too, just for the vertical arrows: pressing Down on the document's
 * very last line, or Up on its very first, otherwise does nothing.
 */
export function createEscapeTrailingBlockPlugin() {
  return new Plugin({
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

        if (!inEscapableBlock && !inTable) {
          // Plain block (paragraph, heading, list item, ...): pressing
          // straight down off the document's last line, or up off its
          // first, has nowhere to go by default. Only vertical arrows get
          // this - Enter/horizontal arrows already behave as expected via
          // ProseMirror's own defaults - and only when that boundary line
          // actually has content, so it doesn't keep stacking empty lines.
          if (event.key === "ArrowDown") {
            if (!view.endOfTextblock("down") || !hasNothingAfter($from))
              return false;
            if ($from.parent.content.size === 0) return false;
            return escapeAfterLastNode(view);
          }
          if (event.key === "ArrowUp") {
            if (!view.endOfTextblock("up") || !hasNothingBefore($from))
              return false;
            if ($from.parent.content.size === 0) return false;
            return escapeBeforeFirstNode(view);
          }
          return false;
        }

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
