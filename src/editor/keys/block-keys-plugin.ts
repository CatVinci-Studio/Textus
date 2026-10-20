import {
  Plugin,
  Selection,
  TextSelection,
  type Command,
  type Transaction,
} from "@milkdown/kit/prose/state";
import type { Node } from "@milkdown/kit/prose/model";
import {
  addRowAfter,
  isInTable,
  selectedRect,
  CellSelection,
} from "@milkdown/kit/prose/tables";
import { splitBlock } from "@milkdown/kit/prose/commands";
import { $prose } from "@milkdown/kit/utils";
import { isImeKeyEvent, stateWithLiveSelection } from "../marks/enclosure";
import { modIsMeta } from "../../platform/os";

/**
 * Enter and Mod+Enter across Textus's container blocks, decided in one
 * place so they follow one rule (issue #28):
 *
 * - Enter on an empty line leaves the block: an empty list item or quote
 *   line (ProseMirror's liftEmptyBlock, untouched here), the empty last
 *   line of a code/math block, the untouched new last row of a table.
 * - Mod+Enter leaves the block from anywhere in it: code blocks (the base
 *   keymap's exitCode), tables (gfm's exitTable), and quotes (here).
 *
 * Inside a table Enter moves down a row, and on the last row adds one, as
 * in Typora and spreadsheets - gfm's own keymap exits the table instead.
 * Enter on a `| a | b |` line turns it into a table.
 *
 * Shift+Enter is left to Milkdown's hardbreak keymap (a line break; a
 * second one right after a break becomes a new paragraph), except where
 * its rule misfires - see shiftEnterWithTrailingBreak - and where a line
 * break can't go: a heading, which can't hold one, splits as with Enter,
 * and a code block takes a newline (Milkdown's filter dropped the key, as
 * it did in a table, where the break is now saved as `<br>`:
 * lineBreakInTableCell).
 *
 * Registered before every other key handler in editor-extensions.ts, and
 * $prose plugins run ahead of the preset keymaps, so these win over gfm's
 * table keymap and ProseMirror's base keymap.
 */

const LEAVABLE_TEXT_BLOCKS = new Set(["code_block", "math_block"]);

/** Puts the cursor in a paragraph right after the node ending at `after`:
 *  the empty paragraph already there, or a new one. */
function landAfter(tr: Transaction, after: number): Transaction {
  const $after = tr.doc.resolve(after);
  const next = $after.nodeAfter;
  if (next?.type.name === "paragraph" && next.content.size === 0) {
    return tr.setSelection(TextSelection.create(tr.doc, after + 1));
  }
  const paragraph = tr.doc.type.schema.nodes.paragraph.create();
  tr.insert(after, paragraph);
  return tr.setSelection(TextSelection.create(tr.doc, after + 1));
}

/** Enter on the empty (or whitespace-only) last line of a code or math block: drop that line
 *  and continue below the block. The first Enter makes the empty line, so
 *  it takes two, as with list items and quotes. */
export const leaveTextBlockOnEmptyLastLine: Command = (state, dispatch) => {
  const { $from, empty } = state.selection;
  if (!empty || !LEAVABLE_TEXT_BLOCKS.has($from.parent.type.name)) return false;
  if ($from.parentOffset !== $from.parent.content.size) return false;
  // The last line counts as empty when it holds only the indentation the
  // code block carried over from the line above.
  const text = $from.parent.textContent;
  const lastBreak = text.lastIndexOf("\n");
  if (lastBreak < 0 || text.slice(lastBreak + 1).trim() !== "") return false;
  if (dispatch) {
    const tr = state.tr.delete(
      $from.pos - (text.length - lastBreak),
      $from.pos,
    );
    dispatch(landAfter(tr, tr.mapping.map($from.after())).scrollIntoView());
  }
  return true;
};

/** Mod+Enter in a quote (or GitHub alert): continue below it. Code blocks
 *  and tables inside the quote keep their own exit. */
export const leaveBlockquote: Command = (state, dispatch) => {
  const { $from } = state.selection;
  if ($from.parent.type.spec.code || isInTable(state)) return false;
  for (let d = $from.depth; d > 0; d--) {
    if ($from.node(d).type.name !== "blockquote") continue;
    if (dispatch)
      dispatch(landAfter(state.tr, $from.after(d)).scrollIntoView());
    return true;
  }
  return false;
};

function rowIsEmpty(row: Node): boolean {
  let empty = true;
  row.forEach((cell) => {
    if (cell.textContent.length > 0) empty = false;
  });
  return empty;
}

/** Cursor at the end of the cell at (row, col) of the table in `tr`. */
function selectCell(
  tr: Transaction,
  tableStart: number,
  row: number,
  col: number,
): Transaction {
  const table = tr.doc.resolve(tableStart).parent;
  const r = Math.min(row, table.childCount - 1);
  const rowNode = table.child(r);
  const c = Math.min(col, rowNode.childCount - 1);
  let pos = tableStart;
  for (let i = 0; i < r; i++) pos += table.child(i).nodeSize;
  pos += 1;
  for (let i = 0; i < c; i++) pos += rowNode.child(i).nodeSize;
  const cellEnd = pos + rowNode.child(c).nodeSize - 1;
  return tr.setSelection(Selection.near(tr.doc.resolve(cellEnd), -1));
}

/** Enter in a table cell: down a row; on the last row, a new row with the
 *  cursor in its first cell, like a new line; on a new last row left empty,
 *  out of the table (the row goes with it). */
export const enterInTable: Command = (state, dispatch) => {
  if (!isInTable(state) || state.selection instanceof CellSelection)
    return false;
  const rect = selectedRect(state);
  const table = rect.table;
  const lastRow = rect.map.height - 1;

  if (rect.top < lastRow) {
    if (dispatch)
      dispatch(
        selectCell(
          state.tr,
          rect.tableStart,
          rect.top + 1,
          rect.left,
        ).scrollIntoView(),
      );
    return true;
  }

  const row = table.child(lastRow);
  if (rowIsEmpty(row)) {
    if (!dispatch) return true;
    const tableEnd = rect.tableStart + table.content.size + 1;
    const tr = state.tr;
    // A table needs one body row; keep the row when it is the only one.
    if (table.childCount > 2) {
      const rowEnd = rect.tableStart + table.content.size;
      tr.delete(rowEnd - row.nodeSize, rowEnd);
    }
    dispatch(landAfter(tr, tr.mapping.map(tableEnd)).scrollIntoView());
    return true;
  }

  if (dispatch)
    addRowAfter(state, (tr) =>
      dispatch(
        selectCell(tr, rect.tableStart, rect.top + 1, 0).scrollIntoView(),
      ),
    );
  return true;
};

/** The cells of a `| a | b |` line, or null when it isn't one. */
export function parsePipeRow(text: string): string[] | null {
  const line = text.trim();
  if (line.length < 3 || !line.startsWith("|") || !line.endsWith("|"))
    return null;
  if (line.endsWith("\\|")) return null;
  const cells = line
    .slice(1, -1)
    .split(/(?<!\\)\|/)
    .map((cell) => cell.trim());
  if (cells.every((cell) => cell.length === 0)) return null;
  return cells;
}

/** Enter on a `| a | b |` paragraph: a table with that header row and one
 *  empty body row, the cursor in its first cell. */
export const pipeRowToTable: Command = (state, dispatch) => {
  const { $from, empty } = state.selection;
  const paragraph = $from.parent;
  if (!empty || paragraph.type.name !== "paragraph" || isInTable(state))
    return false;
  let plain = true;
  paragraph.forEach((child) => {
    if (!child.isText) plain = false;
  });
  if (!plain) return false;
  const cells = parsePipeRow(paragraph.textContent);
  if (!cells) return false;

  const { nodes } = state.schema;
  const container = $from.node($from.depth - 1);
  const index = $from.index($from.depth - 1);
  if (!nodes.table || !container.canReplaceWith(index, index + 1, nodes.table))
    return false;
  if (!dispatch) return true;

  const header = nodes.table_header_row.create(
    null,
    cells.map((text) =>
      nodes.table_header.create(
        null,
        nodes.paragraph.create(null, text ? state.schema.text(text) : null),
      ),
    ),
  );
  const body = nodes.table_row.create(
    null,
    cells.map(() => nodes.table_cell.createAndFill()!),
  );
  const table = nodes.table.create(null, [header, body]);
  const start = $from.before();
  const tr = state.tr.replaceWith(start, $from.after(), table);
  dispatch(selectCell(tr, start + 1, 1, 0).scrollIntoView());
  return true;
};

/** Shift+Enter in a paragraph that already ends in a line break (the user
 *  pressed Shift+Enter at the end, then went back up). Milkdown's
 *  insertHardbreakCommand means "a second break right after a break
 *  becomes a new paragraph", but checks the paragraph's last child instead
 *  of the node before the cursor and replaces the position before the
 *  cursor with a paragraph node. Mid-line that deletes the character
 *  before the cursor and opens paragraph gaps where a line break was asked
 *  for; right after a mid-paragraph break it leaves an empty paragraph
 *  behind. Here the rule is applied as meant. */
export const shiftEnterWithTrailingBreak: Command = (state, dispatch) => {
  const { selection } = state;
  if (!(selection instanceof TextSelection) || !selection.empty) return false;
  const hardbreak = state.schema.nodes.hardbreak;
  const { $from } = selection;
  if (!hardbreak || $from.parent.lastChild?.type !== hardbreak) return false;
  if (!dispatch) return true;
  const tr = state.tr;
  if ($from.nodeBefore?.type === hardbreak) {
    tr.delete($from.pos - 1, $from.pos).split($from.pos - 1);
  } else {
    // The "hardbreak" meta keeps Milkdown's filter (no breaks in code
    // blocks or tables) in charge, as for its own command.
    tr.setMeta("hardbreak", true).replaceSelectionWith(hardbreak.create());
  }
  dispatch(tr.scrollIntoView());
  return true;
};

/** Shift+Enter where Markdown has no line break. A heading is one line:
 *  a break in it saved as a setext heading, `# a` becoming `a\` / `b` /
 *  `==`. A code or math block is all lines already. */
export const shiftEnterWithoutBreak: Command = (state, dispatch) => {
  const { $from } = state.selection;
  let depth = $from.depth;
  while (depth > 0 && !$from.node(depth).isTextblock) depth--;
  const block = $from.node(depth);
  if (block.type.name === "heading") return splitBlock(state, dispatch);
  if (!block.isTextblock || !block.type.spec.code) return false;
  dispatch?.(state.tr.insertText("\n").scrollIntoView());
  return true;
};

/** Enter in inline code (or a wikilink or embed, kept as source text):
 *  a new line, as in bold, where the span splits in two - not a newline
 *  inside the span, which ProseMirror gives anything marked as code and
 *  which reads back as a space. Inline math has its own Enter. */
export const splitInlineCode: Command = (state, dispatch) => {
  const { $from, empty } = state.selection;
  const parent = $from.parent;
  if (!empty || !parent.isInline || !parent.type.spec.code) return false;
  if (parent.type.name === "math_inline") return false;
  return splitBlock(state, dispatch);
};

/** Shift+Enter in a table cell: a line break in the cell, saved as `<br>`
 *  (markdown-output.ts), as a GFM table row can't hold a line end.
 *  Milkdown's own command is filtered out in tables, so it did nothing. */
export const lineBreakInTableCell: Command = (state, dispatch) => {
  const { selection } = state;
  const hardbreak = state.schema.nodes.hardbreak;
  if (!hardbreak || !(selection instanceof TextSelection) || !isInTable(state))
    return false;
  if (!selection.$from.sameParent(selection.$to)) return false;
  if (dispatch)
    dispatch(
      state.tr.replaceSelectionWith(hardbreak.create()).scrollIntoView(),
    );
  return true;
};

const onEnter: Command[] = [
  splitInlineCode,
  enterInTable,
  pipeRowToTable,
  leaveTextBlockOnEmptyLastLine,
];
const onModEnter: Command[] = [leaveBlockquote];
const onShiftEnter: Command[] = [
  shiftEnterWithoutBreak,
  lineBreakInTableCell,
  shiftEnterWithTrailingBreak,
];

/** How soon before Enter a Shift press still counts as part of the same
 *  stroke rather than held on purpose. macOS Pinyin toggles 中/英 with a
 *  Shift tap; when that tap overlaps the Enter after a Latin word, the page
 *  gets Shift+Enter and a line break the writer never asked for. */
export const SHIFT_OVERLAP_MS = 100;

export const blockKeysPlugin = $prose(() => {
  let shiftDownAt = -Infinity;
  return new Plugin({
    props: {
      handleKeyDown(view, event) {
        if (event.key === "Shift") {
          if (!event.repeat) shiftDownAt = event.timeStamp;
          return false;
        }
        if (event.key !== "Enter" || isImeKeyEvent(view, event)) return false;
        if (
          event.shiftKey &&
          !event.metaKey &&
          !event.ctrlKey &&
          !event.altKey &&
          event.timeStamp - shiftDownAt < SHIFT_OVERLAP_MS
        ) {
          // Shift and Enter went down together: an Enter, as meant.
          const plain = new KeyboardEvent("keydown", {
            key: "Enter",
            code: event.code,
            keyCode: 13,
          });
          const handled = view.someProp("handleKeyDown", (f) => f(view, plain));
          if (handled) return true;
        }
        if (event.altKey) return false;
        const mac = modIsMeta();
        const mod = mac ? event.metaKey : event.ctrlKey;
        const other = mac ? event.ctrlKey : event.metaKey;
        if (other || (event.shiftKey && mod)) return false;
        const commands = event.shiftKey
          ? onShiftEnter
          : mod
            ? onModEnter
            : onEnter;
        const state = stateWithLiveSelection(view);
        return commands.some((command) => command(state, view.dispatch, view));
      },
    },
  });
});
