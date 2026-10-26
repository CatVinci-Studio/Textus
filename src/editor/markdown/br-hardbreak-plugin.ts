import type { Node as ProseNode } from "@milkdown/kit/prose/model";
import { Plugin, PluginKey, type Transaction } from "@milkdown/kit/prose/state";
import { $prose, $remark } from "@milkdown/kit/utils";

// Attributed `<br clear="all">` too (Word/Notion paste); a bare `<br>` is
// stripped earlier by Milkdown's remark-preserve-empty-line.
const BR_RE = /^<br(\s[^<>]*)?\/?>$/i;

// GFM tables can't hold a real hardbreak, so `<br>` is the only line break
// in a table cell.
const TABLE_CELL_TYPES = new Set(["table_cell", "table_header"]);

/** `<br>`, `<br/>` or `<br />`, with no attributes. */
const PLAIN_BR_RE = /^<br\s*\/?>$/i;

/**
 * Which of a table cell's pieces are line breaks: every plain `<br>` with
 * something after it. Not the ones that end it: Milkdown writes a cell
 * without its last break, so that `<br>` would be lost on save.
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

/** A `<br>` in a table cell is read as a break, shown as a new line and
 *  written back as `<br>`. */
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
 * A lone `<br>` outside a table becomes a hardbreak, so it round-trips as a
 * Markdown break. Only where a paste or drop changed the document: a typed
 * or the file's own `<br>` stays, or untouched blocks would be rewritten on
 * save. One that starts or ends its paragraph has no break to become.
 */
export const brToHardbreakPlugin = $prose(() => {
  return new Plugin({
    key: new PluginKey("br-to-hardbreak"),
    appendTransaction(transactions, _oldState, newState) {
      // A `<br>` typed by hand is kept as typed.
      const pasted = transactions.filter(
        (tr) =>
          tr.docChanged &&
          ["paste", "drop"].includes(tr.getMeta("uiEvent") as string),
      );
      if (!pasted.length) return null;
      const hardbreakType = newState.schema.nodes.hardbreak;
      if (!hardbreakType) return null;

      const targets: { from: number; to: number }[] = [];
      const visit = (node: ProseNode, pos: number) => {
        if (
          node.isTextblock &&
          TABLE_CELL_TYPES.has(newState.doc.resolve(pos).parent.type.name)
        ) {
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
      for (const [from, to] of changedRanges(
        transactions,
        newState.doc,
        pasted,
      ))
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

/** The ranges the transactions in `only` rewrote, in the final document's
 *  positions. */
function changedRanges(
  transactions: readonly Transaction[],
  doc: ProseNode,
  only: readonly Transaction[],
): [number, number][] {
  const ranges: [number, number][] = [];
  transactions.forEach((tr, t) => {
    if (!only.includes(tr)) return;
    tr.mapping.maps.forEach((map, i) => {
      map.forEach((_oldStart, _oldEnd, newStart, newEnd) => {
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
