import { $remark } from "@milkdown/kit/utils";
import { scanSource, type Range } from "./verbatim-scan";
import { extname } from "../../utils/path";
import { editorExtensions } from "../extension-points";
import { BUILT_IN_KEEP, type VerbatimRules } from "./verbatim-rules";

// Syntax a document type keeps (verbatim-rules) read as raw source (the
// `html` node, saved verbatim), shown as source and never drawn.

/** The rules the document at `path` is read by: its type's, Textus's or
 *  a plugin's that is on. */
export function keepFor(path: string | null): VerbatimRules | null {
  if (!path) return null;
  const ext = extname(path).slice(1).toLowerCase();
  return BUILT_IN_KEEP[ext] ?? editorExtensions().pluginKeep(path);
}

/** HTML that is JSX rather than a tag: a component, a fragment, braces. */
const JSX_HTML = /<\/?[A-Z]|<\/?>|[{}]/;

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

const OPAQUE = new Set(["inlineCode", "html", "inlineMath", "math", "code"]);
const TEXT_PARENTS = new Set(["paragraph", "heading", "tableCell"]);

/** The document's text with its points by offset. */
function sourceOf(text: string) {
  const lineStarts = [0];
  for (let i = 0; i < text.length; i++)
    if (text[i] === "\n") lineStarts.push(i + 1);
  const pointAt = (offset: number): Point => {
    let lo = 0;
    let hi = lineStarts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (lineStarts[mid] <= offset) lo = mid;
      else hi = mid - 1;
    }
    return { line: lo + 1, column: offset - lineStarts[lo] + 1, offset };
  };
  const span = (s: number, e: number) => ({
    start: pointAt(s),
    end: pointAt(e),
  });
  return { text, span };
}
type Source = ReturnType<typeof sourceOf>;

const offsets = (node: MdNode): Range => [
  node.position!.start.offset,
  node.position!.end.offset,
];

const verbatimHtml = (src: Source, [s, e]: Range): MdNode => ({
  type: "html",
  value: src.text.slice(s, e),
  position: src.span(s, e),
  data: { verbatim: true },
});

/** Text that reads as its own source can be cut anywhere. */
const plainText = (node: MdNode, text: string) =>
  node.type === "text" &&
  !!node.position &&
  text.slice(...offsets(node)) === node.value;

/** `children` with `range` as one verbatim node; a child it only partly
 *  covers is cut if plain text, else taken whole. */
function keepRange(children: MdNode[], range: Range, src: Source) {
  let [s, e] = range;
  for (let changed = true; changed;) {
    changed = false;
    for (const child of children) {
      if (!child.position || plainText(child, src.text)) continue;
      const [cs, ce] = offsets(child);
      if (ce > s && cs < e && (cs < s || ce > e)) {
        [s, e] = [Math.min(s, cs), Math.max(e, ce)];
        changed = true;
      }
    }
  }
  const out: MdNode[] = [];
  const piece = (from: number, to: number): MdNode => ({
    type: "text",
    value: src.text.slice(from, to),
    position: src.span(from, to),
  });
  let placed = false;
  for (const child of children) {
    const [cs, ce] = child.position ? offsets(child) : [-1, -1];
    if (cs < 0 || ce <= s || cs >= e) {
      out.push(child);
      continue;
    }
    if (cs < s) out.push(piece(cs, s));
    if (!placed) out.push(verbatimHtml(src, [s, e]));
    placed = true;
    if (ce > e) out.push(piece(e, ce));
  }
  return out;
}

const skipped = (children: MdNode[]) =>
  children.filter((c) => OPAQUE.has(c.type) && c.position).map(offsets);

/** What `rules` keep inside a line of text, kept. */
function keepInline(parent: MdNode, src: Source, rules: VerbatimRules) {
  if (!parent.position || !parent.children?.length) return;
  const [s, e] = offsets(parent);
  const { ranges } = scanSource(
    src.text.slice(s, e),
    s,
    skipped(parent.children),
    rules,
  );
  let kept = parent.children;
  for (const range of ranges.reverse()) kept = keepRange(kept, range, src);
  parent.children = kept;
}

/** Whether top-level `node` is kept whole: a block start, or JSX that
 *  the HTML reader didn't take as HTML. */
function keptWhole(node: MdNode, src: Source, rules: VerbatimRules) {
  if (node.type !== "paragraph" || !node.position) return false;
  const [s, e] = offsets(node);
  const source = src.text.slice(s, e);
  if (rules.blockStarts.some((start) => source.startsWith(start))) return true;
  if (!rules.jsx || !/^<[A-Za-z>/]/.test(source)) return false;
  const first = scanSource(source, s, skipped(node.children ?? []), rules)
    .ranges[0];
  return first?.[0] === s;
}

/** Top-level `children` with each kept block (and those after it while it
 *  is open) as one paragraph of source. */
function keepBlocks(children: MdNode[], src: Source, rules: VerbatimRules) {
  const out: MdNode[] = [];
  for (let i = 0; i < children.length; i++) {
    const node = children[i];
    if (!keptWhole(node, src, rules)) {
      out.push(node);
      continue;
    }
    const [start, first] = offsets(node);
    let end = first;
    const open = () =>
      scanSource(src.text.slice(start, end), start, [], rules).open;
    while (open() && children[i + 1]?.position) end = offsets(children[++i])[1];
    out.push({
      type: "paragraph",
      position: src.span(start, end),
      children: [verbatimHtml(src, [start, end])],
    });
  }
  return out;
}

/** Applies `rules` to the tree read from `text`. */
function keepVerbatim(tree: MdNode, text: string, rules: VerbatimRules) {
  const src = sourceOf(text);
  const walk = (node: MdNode) => {
    for (const child of node.children ?? []) {
      if (child.type === "html") {
        if (rules.jsx && JSX_HTML.test(child.value ?? ""))
          child.data = { ...child.data, verbatim: true };
      } else if (TEXT_PARENTS.has(child.type)) keepInline(child, src, rules);
      walk(child);
    }
  };
  if (tree.children) tree.children = keepBlocks(tree.children, src, rules);
  walk(tree);
}

/** The remark side, with the rules of the document the editor opened:
 *  fixed for its life, so a rename or a plugin turned off midway never
 *  reads it by other rules. */
export const createRemarkVerbatim = (rules: VerbatimRules | null) =>
  $remark("remark-verbatim", () => () => (tree, file) => {
    if (rules) keepVerbatim(tree as MdNode, String(file.value), rules);
  });
