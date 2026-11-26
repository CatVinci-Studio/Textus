import type { Node as ProseNode } from "@milkdown/kit/prose/model";
import { Plugin, PluginKey } from "@milkdown/kit/prose/state";
import { Decoration, type DecorationSet } from "@milkdown/kit/prose/view";
import { $prose } from "@milkdown/kit/utils";
import { decorateAll, redecorateChanged } from "../changed-ranges";

/** On a list item whose first line can stand taller than its text
 *  (editor-lists-tables.css puts its marker on that line's baseline). Set
 *  from the document, not found by `:has()`: a rule styling the item's
 *  children through it made Chromium restyle the whole document on every
 *  block drawn. */
export const TALL_LINE_ATTR = "data-tall-line";

/** The nodes drawn taller than text on the text's own line. Not a picture:
 *  one wider than what is left of the line wraps to a line of its own, and
 *  WebKit then sets the whole item that much lower (#815). */
const TALL: Record<string, (node: ProseNode) => boolean> = {
  math_inline: () => true,
};

/** Whether `item`'s first block is a paragraph holding inline maths. */
function hasTallFirstLine(item: ProseNode): boolean {
  const first = item.firstChild;
  if (first?.type.name !== "paragraph") return false;
  let tall = false;
  // At any depth: bold, italic and links are nodes here, around them.
  first.descendants((node) => {
    if (TALL[node.type.name]?.(node)) tall = true;
    return !tall;
  });
  return tall;
}

const isList = (node: ProseNode) => /_list$/.test(node.type.name);

/** The tall items in a list, the ones in its nested lists too. */
function markTall(list: ProseNode, pos: number): Decoration[] {
  const out: Decoration[] = [];
  list.descendants((node, at) => {
    if (node.type.name !== "list_item") return !node.isTextblock;
    if (hasTallFirstLine(node)) {
      const from = pos + 1 + at;
      out.push(
        Decoration.node(from, from + node.nodeSize, { [TALL_LINE_ATTR]: "" }),
      );
    }
    return true;
  });
  return out;
}

const tallLineKey = new PluginKey<DecorationSet>("list-tall-line");

export const listTallLinePlugin = $prose(
  () =>
    new Plugin<DecorationSet>({
      key: tallLineKey,
      state: {
        init: (_config, state) => decorateAll(state.doc, isList, markTall),
        apply: (tr, set) => redecorateChanged(set, tr, isList, markTall),
      },
      props: {
        decorations: (state) => tallLineKey.getState(state),
      },
    }),
);
