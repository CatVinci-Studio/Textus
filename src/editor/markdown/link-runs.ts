import { Fragment } from "@milkdown/kit/prose/model";
import type {
  Mark,
  Node as ProseNode,
  Schema,
} from "@milkdown/kit/prose/model";
import { firstLink, linked } from "./markdown-output";

/** A link as a run of text under one link mark, and its Markdown source. */

/** The node a link is shown as while the caret is on it. */
export const LINK_SOURCE = "link_source";

/** A run of linked inline content: one link, from `from` to `to`. */
export interface LinkRun {
  from: number;
  to: number;
  link: Mark;
}

/** The link on an inline node: on the node, or (a bold or italic span
 *  inside the link) on everything in it. */
export function linkOf(node: ProseNode): Mark | null {
  const own = node.marks.find((mark) => mark.type.name === "link");
  if (own) return own;
  if (node.type.name !== "md_span") return null;
  const inner = firstLink(node);
  return inner && linked(node, inner) ? inner : null;
}

/** The run of `parent`'s children (its content starting at `start`) that
 *  carry one link and reach `pos`, at either end included. */
export type NodeRun = LinkRun & { nodes: ProseNode[] };

export function runAround(
  parent: ProseNode,
  start: number,
  pos: number,
): NodeRun | null {
  let current: NodeRun | null = null;
  let found: NodeRun | null = null;
  const reaches = (run: NodeRun | null) =>
    run !== null && run.from <= pos && pos <= run.to;
  parent.forEach((child, offset) => {
    if (found) return;
    const from = start + offset;
    const link = linkOf(child);
    if (link && current && link.eq(current.link)) {
      current.to = from + child.nodeSize;
      current.nodes.push(child);
      return;
    }
    if (reaches(current)) found = current;
    else
      current = link
        ? { from, to: from + child.nodeSize, link, nodes: [child] }
        : null;
  });
  return found ?? (reaches(current) ? current : null);
}

/**
 * The link the caret at `pos` is on, inside it or at one of its ends, across
 * the bold or code inside it. A link wholly inside one bold span is looked
 * for inside the span, so the span's `**` stays out of its source.
 */
export function linkRunAt(doc: ProseNode, pos: number): LinkRun | null {
  const $pos = doc.resolve(pos);
  let depth = $pos.depth;
  while (depth > 0 && !$pos.node(depth).isTextblock) depth--;
  let parent = $pos.node(depth);
  if (!parent.isTextblock || parent.type.spec.code) return null;
  let start = $pos.start(depth);
  for (;;) {
    const run = runAround(parent, start, pos);
    if (!run) return null;
    const only = run.nodes.length === 1 ? run.nodes[0] : null;
    if (only?.type.name === "md_span" && !run.link.isInSet(only.marks)) {
      parent = only;
      start = run.from + 1;
      continue;
    }
    return { from: run.from, to: run.to, link: run.link };
  }
}

/**
 * Where in `source` the caret goes that stood `offset` characters into the
 * link's text: the text's characters are found in order through the source,
 * past the syntax between them.
 */
export function caretInSource(
  visible: string,
  source: string,
  offset: number,
): number {
  let at = /^[[<]/.test(source) ? 1 : 0;
  for (const char of visible.slice(0, offset)) {
    const found = source.indexOf(char, at);
    if (found < 0) break;
    at = found + char.length;
  }
  return at;
}

/** What `source` reads as on its own: the inline content of the one
 *  paragraph it makes, or else itself as text. `definitions` are the
 *  document's `[ref]: url` lines, for a reference link. */
export function parseLinkSource(
  parse: (markdown: string) => ProseNode,
  schema: Schema,
  source: string,
  definitions: () => string[],
): Fragment {
  const asText = Fragment.from(source ? schema.text(source) : []);
  const core = source.trim();
  if (!core) return asText;
  // Spaces typed at its ends are text: at a line's start they would make
  // code of it.
  const lead = source.slice(0, source.indexOf(core));
  const trail = source.slice(lead.length + core.length);
  const defs = core.includes("](") || !core.includes("]") ? [] : definitions();
  let doc: ProseNode;
  try {
    doc = parse([core, ...defs].join("\n\n"));
  } catch {
    return asText;
  }
  const first = doc.firstChild;
  if (first?.type.name !== "paragraph") return asText;
  let definition = false;
  first.forEach((child) => {
    definition ||= child.type.name === "link_definition";
  });
  if (definition) return asText;
  const nodes: ProseNode[] = [];
  if (lead) nodes.push(schema.text(lead));
  first.forEach((child) => nodes.push(child));
  if (trail) nodes.push(schema.text(trail));
  return Fragment.fromArray(nodes);
}

/** The source of every `[ref]: url` definition in `doc`. */
export function definitionsIn(doc: ProseNode): string[] {
  const found: string[] = [];
  doc.descendants((node) => {
    if (!node.isTextblock) return true;
    if (node.firstChild?.type.name === "link_definition")
      found.push(node.firstChild.textContent);
    return false;
  });
  return found;
}

/** The parts of a link's source that are syntax, as offsets: its
 *  brackets and what follows the text, or an autolink's `<` `>`. */
export function linkSyntaxRanges(source: string): [number, number][] {
  if (source.startsWith("<") && source.endsWith(">") && source.length > 1)
    return [
      [0, 1],
      [source.length - 1, source.length],
    ];
  if (!source.startsWith("[")) return [];
  let depth = 0;
  for (let i = 0; i < source.length; i++) {
    const char = source[i];
    if (char === "\\") i++;
    else if (char === "[") depth++;
    else if (char === "]" && --depth === 0)
      return [
        [0, 1],
        [i, source.length],
      ];
  }
  return [[0, 1]];
}

/**
 * `doc.textBetween` with each link shown as source read as the link's text,
 * while its source is unchanged, so a pending AI edit isn't dropped by a
 * look at a link.
 */
export function visibleTextBetween(
  doc: ProseNode,
  from: number,
  to: number,
  separator: string,
): string {
  const sources: [number, ProseNode][] = [];
  doc.nodesBetween(from, to, (node, pos) => {
    if (node.type.name !== LINK_SOURCE) return true;
    if (pos >= from && pos + node.nodeSize <= to) sources.push([pos, node]);
    return false;
  });
  if (sources.length === 0) return doc.textBetween(from, to, separator);
  let text = "";
  let at = from;
  for (const [pos, node] of sources) {
    text += doc.textBetween(at, pos, separator);
    text +=
      node.textContent === node.attrs.source
        ? (node.attrs.text as string)
        : node.textContent;
    at = pos + node.nodeSize;
  }
  return text + doc.textBetween(at, to, separator);
}
