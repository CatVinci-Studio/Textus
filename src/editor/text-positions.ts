import type { Node as ProseNode } from "@milkdown/kit/prose/model";

/** The text in [from, to) and each character's document position. Unlike
 *  textBetween, nothing between text nodes (an enclosure's edge, a leaf)
 *  adds characters. */
export function textWithPositions(
  doc: ProseNode,
  from: number,
  to: number,
): { text: string; positions: number[] } {
  const positions: number[] = [];
  let text = "";
  doc.nodesBetween(from, to, (node, pos) => {
    if (!node.isText || !node.text) return true;
    const a = Math.max(pos, from);
    const b = Math.min(pos + node.nodeSize, to);
    for (let p = a; p < b; p++) positions.push(p);
    text += node.text.slice(a - pos, b - pos);
    return true;
  });
  return { text, positions };
}
