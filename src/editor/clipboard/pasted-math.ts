import {
  Fragment,
  Slice,
  type Node as ProseNode,
  type Schema,
} from "@milkdown/kit/prose/model";

/**
 * Formulas written as text in pasted HTML - an AI chat's answer copied from
 * the page, whose TeX is plain text there - made formulas again (#826): a
 * paragraph that is "$$…$$" alone is a math block, "$…$" and "$$…$$" in a
 * line are inline maths. As Pandoc reads dollars: "$" opens before a
 * non-space, closes after one and not before a digit, so "$5 and $10"
 * stays text.
 */

const BLOCK = /^\s*\$\$([\s\S]+?)\$\$\s*$/;
const INLINE = /\$\$([^$]+?)\$\$|\$(?!\s)([^$\n]+?)(?<!\s)\$(?!\d)/g;

/** A paragraph's text, its line breaks as newlines; null when it holds
 *  anything else (a picture, a formula already). */
function plainText(block: ProseNode): string | null {
  let text = "";
  let plain = true;
  block.forEach((child) => {
    if (child.isText) text += child.text;
    else if (child.type.name === "hard_break") text += "\n";
    else plain = false;
  });
  return plain ? text : null;
}

/** A text node's formulas as math_inline nodes, its marks on the rest. */
function splitText(text: ProseNode, schema: Schema): ProseNode[] {
  const inline = schema.nodes.math_inline;
  const value = text.text ?? "";
  if (text.marks.some((mark) => mark.type.spec.code) || !value.includes("$"))
    return [text];
  const out: ProseNode[] = [];
  let at = 0;
  for (const match of value.matchAll(INLINE)) {
    const tex = (match[1] ?? match[2]).trim();
    if (!tex) continue;
    if (match.index > at)
      out.push(schema.text(value.slice(at, match.index), text.marks));
    out.push(
      inline.create(
        { delimiter: match[1] === undefined ? "$" : "$$" },
        schema.text(tex),
      ),
    );
    at = match.index + match[0].length;
  }
  if (!out.length) return [text];
  if (at < value.length) out.push(schema.text(value.slice(at), text.marks));
  return out;
}

function mapFragment(fragment: Fragment, schema: Schema): Fragment {
  const nodes: ProseNode[] = [];
  fragment.forEach((node) => nodes.push(...mapNode(node, schema)));
  return Fragment.fromArray(nodes);
}

function mapNode(node: ProseNode, schema: Schema): ProseNode[] {
  if (node.type.spec.code) return [node];
  if (node.type.name === "paragraph") {
    const text = plainText(node);
    const block = text === null ? null : BLOCK.exec(text);
    if (block?.[1].trim())
      return [
        schema.nodes.math_block.create(null, schema.text(block[1].trim())),
      ];
  }
  if (node.isTextblock) {
    if (!node.type.contentMatch.matchType(schema.nodes.math_inline))
      return [node];
    const children: ProseNode[] = [];
    node.forEach((child) =>
      children.push(...(child.isText ? splitText(child, schema) : [child])),
    );
    return [node.copy(Fragment.fromArray(children))];
  }
  if (node.isLeaf) return [node];
  return [node.copy(mapFragment(node.content, schema))];
}

/** `slice` with the formulas its text holds made maths. */
export function pastedMath(slice: Slice, schema: Schema): Slice {
  if (!schema.nodes.math_inline || !schema.nodes.math_block) return slice;
  if (!slice.content.textBetween(0, slice.content.size, "\n").includes("$"))
    return slice;
  const content = mapFragment(slice.content, schema);
  // A paragraph made a math block at an end is a block there, not open text
  // to pour into the line.
  const changed = (a: ProseNode | null, b: ProseNode | null) =>
    a?.type !== b?.type;
  return new Slice(
    content,
    changed(slice.content.firstChild, content.firstChild) ? 0 : slice.openStart,
    changed(slice.content.lastChild, content.lastChild) ? 0 : slice.openEnd,
  );
}
