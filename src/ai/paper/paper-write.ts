import type { Ctx } from "@milkdown/kit/ctx";
import type { Node as ProseNode } from "@milkdown/kit/prose/model";
import { Fragment, Slice } from "@milkdown/kit/prose/model";
import type { EditorView } from "@milkdown/kit/prose/view";
import { parseMarkdownSource } from "../../editor/markdown/parse-markdown-source";
import { normalizeAiMarkdown } from "../revision/apply-edit";
import { paperRegion, setPaperRegion } from "./paper-region-plugin";

// A paper written straight into the document as it is drafted, with
// nothing to accept (docs/design/ai-paper.md): its place is kept by
// paperRegionPlugin, rewritten as the sections come, and settled as one
// step Undo can take back.

/** A paper written so far on `topic` - its title, `# topic`, right above
 *  its first section's heading - and the blocks after it up to the next
 *  title: what a paper going on after a pause takes back. */
export function writtenPaper(
  doc: ProseNode,
  topic: string,
  firstTitle: string,
): { from: number; to: number } | null {
  const heading = (node: ProseNode | null, level: number, text: string) =>
    node?.type.name === "heading" &&
    node.attrs.level === level &&
    node.textContent.trim() === text.trim();
  let pos = 0;
  let from = -1;
  for (let i = 0; i < doc.childCount; i++) {
    const node = doc.child(i);
    if (from < 0) {
      if (
        heading(node, 1, topic) &&
        heading(i + 1 < doc.childCount ? doc.child(i + 1) : null, 2, firstTitle)
      )
        from = pos;
    } else if (node.type.name === "heading" && node.attrs.level === 1) {
      return { from, to: pos };
    }
    pos += node.nodeSize;
  }
  return from < 0 ? null : { from, to: doc.content.size };
}

/** Gives the paper its place: `place` when it is given, the paper written
 *  so far; else the whole document when that is empty, so no blank line is
 *  left above it, else after the end. Returns what the place held, which
 *  settling puts back before the paper goes in for good. */
export function beginPaper(
  view: EditorView,
  place: { from: number; to: number } | null = null,
): Slice {
  const { doc } = view.state;
  const first = doc.firstChild;
  const empty =
    doc.childCount === 1 && first?.isTextblock && first.content.size === 0;
  const region =
    place ??
    (empty
      ? { from: 0, to: doc.content.size }
      : { from: doc.content.size, to: doc.content.size });
  const tr = setPaperRegion(view.state.tr, region);
  view.dispatch(tr.setMeta("addToHistory", false));
  return doc.slice(region.from, region.to);
}

function parsed(ctx: Ctx, markdown: string): Fragment | null {
  return (
    parseMarkdownSource(ctx, normalizeAiMarkdown(markdown))?.content ?? null
  );
}

/** Whether `pos` falls between two top-level blocks. */
function between(doc: ProseNode, pos: number): boolean {
  return pos >= 0 && pos <= doc.content.size && doc.resolve(pos).depth === 0;
}

/**
 * The paper's place rewritten to `markdown`, out of the undo history.
 * Only the top-level blocks that differ are replaced: a section being
 * written changes its own paragraphs, and the rest - charts among them -
 * stay as drawn. One parse of the paper, a few times a second at most.
 */
export function writePaper(view: EditorView, ctx: Ctx, markdown: string) {
  const { state } = view;
  const region = paperRegion(state);
  const next = region && parsed(ctx, markdown);
  if (!region || !next) return;
  if (!between(state.doc, region.from) || !between(state.doc, region.to)) {
    // The user's edit cut into its edge: the place is the paper's alone.
    const tr = state.tr.replace(region.from, region.to, new Slice(next, 0, 0));
    const to = tr.mapping.map(region.to, 1);
    view.dispatch(
      setPaperRegion(tr, { from: region.from, to }).setMeta(
        "addToHistory",
        false,
      ),
    );
    return;
  }
  const old = state.doc.slice(region.from, region.to).content;
  let start = 0;
  while (
    start < old.childCount &&
    start < next.childCount &&
    old.child(start).eq(next.child(start))
  )
    start++;
  let endOld = old.childCount;
  let endNew = next.childCount;
  while (
    endOld > start &&
    endNew > start &&
    old.child(endOld - 1).eq(next.child(endNew - 1))
  ) {
    endOld--;
    endNew--;
  }
  if (start === endOld && start === endNew) return;
  let from = region.from;
  for (let i = 0; i < start; i++) from += old.child(i).nodeSize;
  let to = from;
  for (let i = start; i < endOld; i++) to += old.child(i).nodeSize;
  const blocks: ProseNode[] = [];
  for (let i = start; i < endNew; i++) blocks.push(next.child(i));
  const tr = state.tr.replaceWith(from, to, blocks);
  setPaperRegion(tr, { from: region.from, to: region.from + next.size });
  view.dispatch(tr.setMeta("addToHistory", false));
}

/**
 * The paper put in for good as `markdown`, and its place given up: what the
 * place held is put back out of the history, and the paper written over it
 * as one step, so one Undo takes the whole paper out. With no `markdown`
 * the place only gets back what it held.
 */
export function settlePaper(
  view: EditorView,
  ctx: Ctx,
  markdown: string | null,
  original: Slice,
) {
  const region = paperRegion(view.state);
  if (!region) return;
  const restore = view.state.tr.replace(region.from, region.to, original);
  view.dispatch(setPaperRegion(restore, null).setMeta("addToHistory", false));
  const content = markdown && parsed(ctx, markdown);
  if (!content) return;
  const at = region.from;
  view.dispatch(
    view.state.tr.replace(at, at + original.size, new Slice(content, 0, 0)),
  );
}
