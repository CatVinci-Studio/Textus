import { $remark } from "@milkdown/kit/utils";
import { extname } from "../../utils/path";

/**
 * Syntax a document type keeps exactly as written: read as raw source
 * (the `html` node, saved verbatim), shown as source and never drawn.
 * Rules are data, so other document types can declare their own.
 */
export interface VerbatimRules {
  /** A top-level paragraph whose source matches is kept whole. */
  blocks: RegExp[];
  /** `{…}` with balanced braces, inside any line of text, is kept. */
  braces: boolean;
  /** HTML that is source, never drawn (a component, not a tag). */
  sourceHtml?: RegExp;
}

const MDX: VerbatimRules = {
  blocks: [/^(?:import|export)\s/, /^\{[\s\S]*\}\s*$/],
  braces: true,
  sourceHtml: /<\/?[A-Z]|<\/?>|[{}]/,
};

const BY_EXTENSION: Record<string, VerbatimRules> = { mdx: MDX };

export function verbatimRulesFor(path: string | null): VerbatimRules | null {
  return path
    ? (BY_EXTENSION[extname(path).slice(1).toLowerCase()] ?? null)
    : null;
}

interface Point {
  line: number;
  column: number;
  offset: number;
}
interface MdNode {
  type: string;
  value?: string;
  children?: MdNode[];
  position?: { start: Point; end: Point };
  data?: Record<string, unknown>;
}

const verbatimHtml = (
  value: string,
  position?: MdNode["position"],
): MdNode => ({
  type: "html",
  value,
  position,
  data: { verbatim: true },
});

/** `[start, end)` of each top-level `{…}` in `source`, skipping `skip`
 *  ranges (code, HTML) and `\{`; an unclosed brace keeps nothing. */
export function braceRanges(
  source: string,
  base: number,
  skip: [number, number][],
): [number, number][] {
  const ranges: [number, number][] = [];
  let depth = 0;
  let start = -1;
  for (let i = 0; i < source.length; i++) {
    const at = base + i;
    const skipped = skip.find(([s, e]) => at >= s && at < e);
    if (skipped) {
      i = skipped[1] - base - 1;
      continue;
    }
    const ch = source[i];
    if (ch === "\\" && depth === 0) i++;
    else if (ch === "{") {
      if (depth++ === 0) start = at;
    } else if (ch === "}" && depth > 0 && --depth === 0) {
      ranges.push([start, at + 1]);
    }
  }
  return ranges;
}

const offsets = (node: MdNode) =>
  [node.position!.start.offset, node.position!.end.offset] as const;

/** Text that reads as its own source can be cut anywhere. */
const plainText = (node: MdNode, text: string) => {
  if (node.type !== "text" || !node.position) return false;
  const [s, e] = offsets(node);
  return text.slice(s, e) === node.value;
};

function pointAt(text: string, offset: number): Point {
  const before = text.slice(0, offset);
  const line = before.split("\n").length;
  return { line, column: offset - before.lastIndexOf("\n"), offset };
}

/** `children` with `[s, e)` of `text` as one verbatim node; a child the
 *  range only partly covers is cut if plain text, else taken whole. */
function keepRange(children: MdNode[], s: number, e: number, text: string) {
  let changed = true;
  while (changed) {
    changed = false;
    for (const child of children) {
      if (!child.position) continue;
      const [cs, ce] = offsets(child);
      if (ce <= s || cs >= e || plainText(child, text)) continue;
      if (cs < s || ce > e) {
        [s, e] = [Math.min(s, cs), Math.max(e, ce)];
        changed = true;
      }
    }
  }
  const out: MdNode[] = [];
  const piece = (from: number, to: number): MdNode => ({
    type: "text",
    value: text.slice(from, to),
    position: { start: pointAt(text, from), end: pointAt(text, to) },
  });
  let placed = false;
  for (const child of children) {
    const [cs, ce] = child.position ? offsets(child) : [-1, -1];
    if (cs < 0 || ce <= s || cs >= e) {
      out.push(child);
      continue;
    }
    if (cs < s) out.push(piece(cs, s));
    if (!placed) {
      const position = { start: pointAt(text, s), end: pointAt(text, e) };
      out.push(verbatimHtml(text.slice(s, e), position));
      placed = true;
    }
    if (ce > e) out.push(piece(e, ce));
  }
  return out;
}

const OPAQUE = new Set(["inlineCode", "html", "inlineMath", "math", "code"]);

function keepBraces(parent: MdNode, text: string) {
  const children = parent.children!;
  if (!parent.position || children.length === 0) return;
  const [s, e] = offsets(parent);
  const skip = children
    .filter((c) => OPAQUE.has(c.type) && c.position)
    .map((c) => [...offsets(c)] as [number, number]);
  const ranges = braceRanges(text.slice(s, e), s, skip);
  let kept = children;
  for (const [from, to] of ranges.reverse())
    kept = keepRange(kept, from, to, text);
  parent.children = kept;
}

const TEXT_PARENTS = new Set(["paragraph", "heading", "tableCell"]);

/** Applies `rules` to the tree read from `text`. */
export function keepVerbatim(tree: MdNode, text: string, rules: VerbatimRules) {
  const walk = (node: MdNode, top: boolean) => {
    for (const child of node.children ?? []) {
      if (child.type === "html" && rules.sourceHtml?.test(child.value ?? ""))
        child.data = { ...child.data, verbatim: true };
      if (child.type === "paragraph" && top && child.position) {
        const [s, e] = offsets(child);
        const source = text.slice(s, e);
        if (rules.blocks.some((re) => re.test(source))) {
          child.children = [verbatimHtml(source, child.position)];
          continue;
        }
      }
      if (rules.braces && TEXT_PARENTS.has(child.type)) keepBraces(child, text);
      walk(child, false);
    }
  };
  walk(tree, true);
}

/** The remark side, for the document at `docPath()`. */
export const createRemarkVerbatim = (docPath: () => string | null) =>
  $remark("remark-verbatim", () => () => (tree, file) => {
    const rules = verbatimRulesFor(docPath());
    if (rules) keepVerbatim(tree as MdNode, String(file.value), rules);
  });
