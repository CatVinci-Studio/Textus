import type { Node as ProseNode } from "@milkdown/kit/prose/model";
import type { EditorView } from "@milkdown/kit/prose/view";
import { revealPosition } from "../reveal-position";
import { headingIndex, headingSlug } from "./link-target";
import { shownText } from "./link-source";

/**
 * The position inside what `anchor` names, or null: a block for `^id`; for
 * `A#B` (a wikilink's levels) the heading B under A; else the heading by its
 * slug, numbering repeats the way GitHub does ("intro", "intro-1").
 */
export function headingPos(doc: ProseNode, anchor: string): number | null {
  if (anchor.startsWith("^")) return blockPos(doc, anchor.slice(1));
  const levels = anchor.split("#").filter(Boolean);
  if (levels.length > 1) return nestedHeadingPos(doc, levels);
  const headings: { text: string; pos: number }[] = [];
  doc.descendants((node, pos) => {
    if (node.type.name !== "heading") return true;
    headings.push({ text: shownText(node), pos: pos + 1 });
    return false;
  });
  const at = headingIndex(
    headings.map((h) => h.text),
    anchor,
  );
  return at < 0 ? null : headings[at].pos;
}

/** The heading the last of `levels` names inside the sections of the ones
 *  before it, as Obsidian reads `[[Note#A#B]]`. */
function nestedHeadingPos(doc: ProseNode, levels: string[]): number | null {
  const headings: { level: number; slug: string; pos: number }[] = [];
  doc.descendants((node, pos) => {
    if (node.type.name === "heading")
      headings.push({
        level: node.attrs.level as number,
        slug: headingSlug(node.textContent),
        pos: pos + 1,
      });
    return node.type.name !== "heading" && !node.isTextblock;
  });
  let from = 0;
  let to = headings.length;
  let found: number | null = null;
  for (const level of levels) {
    const slug = headingSlug(level);
    const at = headings.findIndex(
      (h, i) => i >= from && i < to && h.slug === slug,
    );
    if (at < 0) return null;
    found = headings[at].pos;
    from = at + 1;
    const end = headings.findIndex(
      (h, i) => i > at && h.level <= headings[at].level,
    );
    to = end < 0 ? to : Math.min(to, end);
  }
  return found;
}

/** The block with the Obsidian id `id`: a textblock ending " ^id", or for an
 *  `^id` line of its own, the block before it (a list, a table, a quote). */
export function blockPos(doc: ProseNode, id: string): number | null {
  if (!/^[\w-]+$/.test(id)) return null;
  const tail = new RegExp(`(?:^|\\s)\\^${id}$`);
  let found: number | null = null;
  let previous: number | null = null;
  doc.descendants((node, pos, parent) => {
    if (found !== null) return false;
    if (!node.isTextblock) {
      if (parent === doc) previous = pos + 1;
      return true;
    }
    const text = node.textContent.trimEnd();
    if (text === `^${id}` && parent === doc) found = previous ?? pos + 1;
    else if (tail.test(text)) found = pos + 1;
    if (parent === doc) previous = pos + 1;
    return false;
  });
  return found;
}

/** The start of the line holding the HTML element with `id` or `name`
 *  `anchor` (`<a id="note1"></a>`), the way a hand-made table of contents
 *  links to a spot in the text. Not the element itself: its source is
 *  hidden while the caret is elsewhere, so it has no place on screen. */
export function htmlAnchorPos(doc: ProseNode, anchor: string): number | null {
  const quoted = anchor.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const named = new RegExp(
    `<[a-z][^>]*\\s(?:id|name)\\s*=\\s*(["']?)${quoted}\\1(?=[\\s/>])`,
    "i",
  );
  let found: number | null = null;
  doc.descendants((node, pos) => {
    if (found !== null) return false;
    if (node.isTextblock) {
      node.forEach((child) => {
        if (child.type.name === "html" && named.test(child.textContent))
          found = pos + 1;
      });
      return false;
    }
    return true;
  });
  return found;
}

/** The position inside the reference-list entry `ref-<n>` names: the last
 *  paragraph that starts "[n]", the way a paper's numbered citations link
 *  to their sources (docs/design/ai-paper.md). Null for any other anchor. */
export function referencePos(doc: ProseNode, anchor: string): number | null {
  const n = /^ref-(\d+)$/.exec(anchor)?.[1];
  if (!n) return null;
  let found: number | null = null;
  doc.descendants((node, pos) => {
    if (!node.isTextblock) return true;
    if (node.type.name === "paragraph" && node.textContent.startsWith(`[${n}]`))
      found = pos + 1;
    return false;
  });
  return found;
}

/** Scrolls to the document's `index`-th top-level heading, as the outline
 *  lists them. */
export function revealNthHeading(view: EditorView, index: number): boolean {
  let count = 0;
  let found: number | null = null;
  view.state.doc.forEach((node, offset) => {
    if (found === null && node.type.name === "heading" && count++ === index)
      found = offset + 1;
  });
  if (found === null) return false;
  revealPosition(view, found, "top");
  return true;
}

/**
 * Scrolls to what `anchor` names: a heading, an HTML element's id, or the
 * reference `ref-<n>`. False when the document has none; nothing moves then.
 */
export function revealHeading(view: EditorView, anchor: string): boolean {
  const { doc } = view.state;
  const pos =
    headingPos(doc, anchor) ??
    htmlAnchorPos(doc, anchor) ??
    referencePos(doc, anchor);
  if (pos === null) return false;
  revealPosition(view, pos);
  return true;
}
