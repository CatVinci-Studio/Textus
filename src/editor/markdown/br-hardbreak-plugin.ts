import type { Node as ProseNode } from "@milkdown/kit/prose/model";
import { Plugin, PluginKey, type Transaction } from "@milkdown/kit/prose/state";
import { $prose } from "@milkdown/kit/utils";

// Attributes included (e.g. Word/Notion/Google Docs paste tends to emit
// `<br clear="all">`) - a bare `<br>`/`<br/>` with no attributes never even
// reaches here, since Milkdown's own remark-preserve-empty-line plugin
// (its "blank line" placeholder mechanism) already strips those from the
// tree unconditionally; only the attributed form survives as a real node.
const BR_RE = /^<br(\s[^<>]*)?\/?>$/i;

// GFM tables can't hold a real hardbreak - Milkdown's own
// hardbreakFilterPlugin blocks Shift-Enter inside "table"/"code_block", and
// mdast-util-to-markdown's hardBreak serializer degrades to a single space
// there anyway - so `<br>` is the only way to represent a line break inside
// a table cell. Leave those alone; only paragraphs (typed or pasted <br>)
// get normalized.
const TABLE_CELL_TYPES = new Set(["table_cell", "table_header"]);

/**
 * A lone `<br>`/`<br/>`/`<br />` raw-HTML node (see raw-html-schema.ts) sitting
 * outside a table is really just a line break - normalize it to a genuine
 * hardbreak node so it round-trips as a proper markdown break (backslash +
 * newline) instead of literal `<br/>` text surviving in the saved file.
 */
export const brToHardbreakPlugin = $prose(() => {
  // A file's existing <br> nodes are normalized on its first edit, so that
  // edit walks the whole document; every later one only re-checks the
  // ranges it touched, the only places a new <br> can have appeared.
  let normalizedAll = false;
  return new Plugin({
    key: new PluginKey("br-to-hardbreak"),
    appendTransaction(transactions, _oldState, newState) {
      if (!transactions.some((tr) => tr.docChanged)) return null;
      const hardbreakType = newState.schema.nodes.hardbreak;
      if (!hardbreakType) return null;

      const targets: { from: number; to: number }[] = [];
      const visit = (node: ProseNode, pos: number) => {
        if (node.type.name !== "html" || !BR_RE.test(node.textContent.trim()))
          return true;
        const $pos = newState.doc.resolve(pos);
        for (let d = $pos.depth; d >= 0; d--) {
          if (TABLE_CELL_TYPES.has($pos.node(d).type.name)) return true;
        }
        // A <br> that starts or ends its paragraph stays HTML: a Markdown
        // break only stands between two pieces of a paragraph, and one on
        // a line of its own was saved as nothing. One at the end of a line
        // becomes one break with that line end, not a break and a line
        // end, which wrote a blank line and split the paragraph.
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
      if (normalizedAll) {
        for (const [from, to] of changedRanges(transactions, newState.doc))
          newState.doc.nodesBetween(from, to, visit);
      } else {
        newState.doc.descendants(visit);
        normalizedAll = true;
      }
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
