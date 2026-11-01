import type { Node as ProseNode } from "@milkdown/kit/prose/model";
import type { EditorView } from "@milkdown/kit/prose/view";
import { unfoldRange } from "../html/details-fold";
import { revealPosition } from "../reveal-position";
import { headingSlug } from "./link-target";

/** The position inside the heading `anchor` names, numbering repeats the
 *  way GitHub does ("intro", "intro-1"), or null. */
export function headingPos(doc: ProseNode, anchor: string): number | null {
  const wanted = headingSlug(anchor);
  const seen = new Map<string, number>();
  let found: number | null = null;
  doc.descendants((node, pos) => {
    if (found !== null) return false;
    if (node.type.name !== "heading") return true;
    const slug = headingSlug(node.textContent);
    const repeat = seen.get(slug) ?? 0;
    seen.set(slug, repeat + 1);
    if ((repeat ? `${slug}-${repeat}` : slug) === wanted) found = pos + 1;
    return false;
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

/**
 * Scrolls to the heading `anchor` names, or the reference `ref-<n>` names. False when the document has no such
 * heading; nothing moves then.
 */
export function revealHeading(view: EditorView, anchor: string): boolean {
  const pos =
    headingPos(view.state.doc, anchor) ?? referencePos(view.state.doc, anchor);
  if (pos === null) return false;
  // A heading in a folded <details> has no place on screen until it opens.
  unfoldRange(view, pos);
  revealPosition(view, pos);
  return true;
}
