import type { Node as ProseNode } from "@milkdown/kit/prose/model";
import { Plugin, PluginKey, type Transaction } from "@milkdown/kit/prose/state";
import { $prose, $remark } from "@milkdown/kit/utils";

// Attributes included (e.g. Word/Notion/Google Docs paste tends to emit
// `<br clear="all">`) - a bare `<br>`/`<br/>` with no attributes never even
// reaches here, since Milkdown's own remark-preserve-empty-line plugin
// (its "blank line" placeholder mechanism) already strips those from the
// tree unconditionally; only the attributed form survives as a real node.
const BR_RE = /^<br(\s[^<>]*)?\/?>$/i;

// GFM tables can't hold a real hardbreak, so `<br>` is the only way to
// write a line break inside a table cell: see the cell rules below.
const TABLE_CELL_TYPES = new Set(["table_cell", "table_header"]);

/** `<br>`, `<br/>` or `<br />`, with no attributes. */
const PLAIN_BR_RE = /^<br\s*\/?>$/i;

/**
 * Which of a table cell's inline pieces (`isBr` tells a plain `<br>`) are
 * line breaks: every plain `<br>` with something after it in the cell.
 * Not the ones that end it: Milkdown writes a cell without its last break,
 * and the `<br>` would be gone from the file on the next save.
 */
function cellBreaks<T>(pieces: readonly T[], isBr: (piece: T) => boolean) {
  let lastContent = pieces.length - 1;
  while (lastContent >= 0 && isBr(pieces[lastContent])) lastContent--;
  return pieces.map((piece, i) => i < lastContent && isBr(piece));
}

interface MdastNode {
  type: string;
  value?: string;
  children?: MdastNode[];
}

const isMdastBr = (node: MdastNode) =>
  node.type === "html" && PLAIN_BR_RE.test(node.value ?? "");

/**
 * A `<br>` in a table cell, the line break Shift+Enter makes there
 * (block-keys-plugin.ts), is read as a break (cellBreaks): shown as a new
 * line in the cell, not as the tag, and written back as `<br>`
 * (markdown-output.ts).
 */
export const remarkTableCellBreaks = $remark(
  "remark-table-cell-breaks",
  () => () => (tree: unknown) => {
    const walk = (node: MdastNode) => {
      if (node.type !== "tableCell") return node.children?.forEach(walk);
      const children = node.children ?? [];
      cellBreaks(children, isMdastBr).forEach((isBreak, i) => {
        if (isBreak) children[i] = { type: "break" };
      });
    };
    walk(tree as MdastNode);
  },
);

/**
 * A lone `<br>`/`<br/>`/`<br />` raw-HTML node (see raw-html-schema.ts) sitting
 * outside a table is really just a line break - normalize it to a genuine
 * hardbreak node so it round-trips as a proper markdown break (backslash +
 * newline) instead of literal `<br/>` text surviving in the saved file.
 *
 * Only where a transaction changed the document - a `<br>` typed or pasted.
 * The file's own `<br>`s stay as written: saving writes every block the
 * user didn't edit back as the file has it (source-preserving.ts), and a
 * `<br>` turned into a break on the first edit anywhere - or on opening,
 * when a plugin's first transaction (heading ids) touched the document -
 * made its block one the user didn't edit but the save rewrote.
 *
 * A `<br>` that starts or ends its paragraph has no Markdown break to
 * become, and stays HTML: a break only stands between two pieces of a
 * paragraph (at the end, `\` is a literal backslash). A `<br>` at the end of a line is the
 * break and the line end together, `a<br>\nb`: it becomes one break, not a
 * break and then a line end, which wrote a blank line and split the
 * paragraph.
 *
 * In an edited table cell, the `<br>`s the file would read back as breaks
 * (cellBreaks): one that ended the cell does once text is typed after it.
 */
export const brToHardbreakPlugin = $prose(() => {
  return new Plugin({
    key: new PluginKey("br-to-hardbreak"),
    appendTransaction(transactions, _oldState, newState) {
      if (!transactions.some((tr) => tr.docChanged)) return null;
      const hardbreakType = newState.schema.nodes.hardbreak;
      if (!hardbreakType) return null;

      const targets: { from: number; to: number }[] = [];
      const visit = (node: ProseNode, pos: number) => {
        if (
          node.isTextblock &&
          TABLE_CELL_TYPES.has(newState.doc.resolve(pos).parent.type.name)
        ) {
          // An edited cell, as it would read back from the file.
          const pieces: { node: ProseNode; pos: number }[] = [];
          node.forEach((child, offset) =>
            pieces.push({ node: child, pos: pos + 1 + offset }),
          );
          const isBr = ({ node: child }: (typeof pieces)[number]) =>
            child.type.name === "html" &&
            PLAIN_BR_RE.test(child.textContent.trim());
          cellBreaks(pieces, isBr).forEach((isBreak, i) => {
            const { node: child, pos: at } = pieces[i];
            if (isBreak && !targets.some((t) => t.from === at))
              targets.push({ from: at, to: at + child.nodeSize });
          });
          return false;
        }
        if (node.type.name !== "html" || !BR_RE.test(node.textContent.trim()))
          return true;
        const $pos = newState.doc.resolve(pos);
        for (let d = $pos.depth; d >= 0; d--) {
          if (TABLE_CELL_TYPES.has($pos.node(d).type.name)) return true;
        }
        const next = $pos.parent.maybeChild($pos.index() + 1);
        if (!next || $pos.index() === 0) return true;
        const to =
          next.type === hardbreakType && next.attrs.isInline
            ? pos + node.nodeSize + next.nodeSize
            : pos + node.nodeSize;
        if (!targets.some((t) => t.from === pos))
          targets.push({ from: pos, to });
        return true;
      };
      for (const [from, to] of changedRanges(transactions, newState.doc))
        newState.doc.nodesBetween(from, to, visit);
      if (targets.length === 0) return null;

      let tr = newState.tr;
      targets.sort((a, b) => b.from - a.from);
      for (const { from, to } of targets) {
        tr = tr.replaceWith(from, to, hardbreakType.create());
      }
      return tr;
    },
  });
});

/** The ranges `transactions` rewrote, in `doc`'s (the final) positions. */
function changedRanges(
  transactions: readonly Transaction[],
  doc: ProseNode,
): [number, number][] {
  const ranges: [number, number][] = [];
  transactions.forEach((tr, t) => {
    tr.mapping.maps.forEach((map, i) => {
      map.forEach((_oldStart, _oldEnd, newStart, newEnd) => {
        // Carried through every later step, this transaction's and the
        // ones after it, to land in final-document positions.
        let from = tr.mapping.slice(i + 1).map(newStart, -1);
        let to = tr.mapping.slice(i + 1).map(newEnd, 1);
        for (const later of transactions.slice(t + 1)) {
          from = later.mapping.map(from, -1);
          to = later.mapping.map(to, 1);
        }
        ranges.push([
          Math.max(0, Math.min(from, doc.content.size)),
          Math.max(0, Math.min(to, doc.content.size)),
        ]);
      });
    });
  });
  return ranges;
}
