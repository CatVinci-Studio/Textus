import { Plugin, PluginKey, type Selection } from "@milkdown/kit/prose/state";
import { Decoration, DecorationSet } from "@milkdown/kit/prose/view";
import { $prose } from "@milkdown/kit/utils";
import type { Node as ProseNode } from "@milkdown/kit/prose/model";

/**
 * Markdown between an aligning tag on a line of its own and its closing tag
 * - `<div align="center">`, a blank line, the markdown, a blank line,
 * `</div>`, as README headers are written - is aligned as GitHub shows it.
 * The tags themselves are hidden, as there, until the caret is on one.
 */

export type Align = "left" | "center" | "right";

const OPEN_RE = /^<(div|p)\s+align\s*=\s*["']?(left|center|right)["']?\s*>$/i;
const CENTER_RE = /^<center\s*>$/i;
const CLOSE_RE = /^<\/(div|p|center)\s*>$/i;

/** A top-level paragraph that is one HTML node: its source, trimmed. */
function loneTag(node: ProseNode): string | null {
  if (node.type.name !== "paragraph" || node.childCount !== 1) return null;
  const child = node.firstChild!;
  return child.type.name === "html" ? child.textContent.trim() : null;
}

/** Each top-level block inside an aligning tag, with its alignment, and
 *  the tag lines that open and close them (`tags`). */
export function alignedBlocks(
  doc: ProseNode,
  tags: { from: number; to: number }[] = [],
): { from: number; to: number; align: Align }[] {
  const out: { from: number; to: number; align: Align }[] = [];
  const tagAt = (pos: number, node: ProseNode) =>
    tags.push({ from: pos, to: pos + node.nodeSize });
  const open: { tag: string; align: Align }[] = [];
  doc.forEach((node, pos) => {
    const tag = loneTag(node);
    const opens = tag ? OPEN_RE.exec(tag) : null;
    if (opens) {
      open.push({
        tag: opens[1].toLowerCase(),
        align: opens[2].toLowerCase() as Align,
      });
      tagAt(pos, node);
      return;
    }
    if (tag && CENTER_RE.test(tag)) {
      open.push({ tag: "center", align: "center" });
      tagAt(pos, node);
      return;
    }
    const closes = tag ? CLOSE_RE.exec(tag) : null;
    if (closes) {
      const at = open.map((o) => o.tag).lastIndexOf(closes[1].toLowerCase());
      if (at >= 0) {
        open.length = at;
        tagAt(pos, node);
      }
      return;
    }
    if (open.length)
      out.push({
        from: pos,
        to: pos + node.nodeSize,
        align: open[open.length - 1].align,
      });
  });
  return out;
}

function draw(doc: ProseNode, selection: Selection): DecorationSet {
  const tags: { from: number; to: number }[] = [];
  const blocks = alignedBlocks(doc, tags).map(({ from, to, align }) =>
    Decoration.node(from, to, { class: `html-align-${align}` }),
  );
  const hidden = tags
    .filter(({ from, to }) => selection.to < from || selection.from > to)
    .map(({ from, to }) =>
      Decoration.node(from, to, { class: "html-align-tag" }),
    );
  return DecorationSet.create(doc, [...blocks, ...hidden]);
}

const key = new PluginKey<DecorationSet>("html-align");

export const htmlAlignPlugin = $prose(
  () =>
    new Plugin<DecorationSet>({
      key,
      state: {
        init: (_config, state) => draw(state.doc, state.selection),
        apply: (tr, prev, _old, state) =>
          tr.docChanged || tr.selectionSet
            ? draw(state.doc, state.selection)
            : prev,
      },
      props: {
        decorations: (state) => key.getState(state),
      },
    }),
);
