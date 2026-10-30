import type { Ctx } from "@milkdown/kit/ctx";
import { editorViewCtx } from "@milkdown/kit/core";
import { closeHistory } from "@milkdown/kit/prose/history";
import { Selection, TextSelection } from "@milkdown/kit/prose/state";
import type { Node as ProseNode } from "@milkdown/kit/prose/model";
import type { EditProposal } from "../../ai/types";
import { serializeBlocks } from "../../ai/doc-markdown";
import { resolveAnchored } from "../../ai/revision/pending-place";
import { replaceWithMarkdown } from "../../ai/revision/apply-edit";
import { locatePlainText } from "../../ai/revision/text-locate";
import { parseMarkdownSource } from "../../editor/markdown/parse-markdown-source";
import type { DocumentPlace } from "../../plugins/app-bridge";
import { markChangeSource } from "../../editor/change-source";

/**
 * A plugin's edits to the document in front, placed by block ids in order
 * and written in one transaction (one undo). Nothing is written when one
 * can't be placed.
 */
export function applyPluginEdits(ctx: Ctx, edits: EditProposal[]): boolean {
  const view = ctx.get(editorViewCtx);
  let tr = view.state.tr;
  for (const edit of edits) {
    const text = edit.text ?? "";
    if (
      edit.action === "insert_at_cursor" ||
      edit.action === "replace_selection"
    ) {
      const { from, to } = tr.selection;
      const end = edit.action === "insert_at_cursor" ? from : to;
      tr = replaceWithMarkdown(tr, ctx, from, end, text);
      continue;
    }
    if (edit.action === "append") {
      const end = tr.doc.content.size;
      tr = replaceWithMarkdown(tr, ctx, end, end, `\n\n${text}`);
      continue;
    }
    // The block (or run) is written again whole, its new Markdown composed
    // around the anchor as an accepted proposal's is.
    const placed = resolveAnchored(
      ctx,
      tr.doc,
      serializeBlocks(ctx, tr.doc),
      edit,
    );
    if (!placed) return false;
    tr = replaceWithMarkdown(
      tr,
      ctx,
      placed.range.from,
      placed.range.to,
      placed.replacement,
    );
  }
  if (!tr.docChanged) return true;
  closeHistory(tr);
  view.dispatch(markChangeSource(tr, "plugin").scrollIntoView());
  return true;
}

/** Where `place` is in `doc`: its block, its heading, its words, or the
 *  block its line falls in - the first of them that is found. */
export function findPlace(
  ctx: Ctx,
  doc: ProseNode,
  place: DocumentPlace,
): number | null {
  const blocks = serializeBlocks(ctx, doc);
  if (place.block) {
    const block = blocks.find((b) => b.id === place.block?.replace(/^#/, ""));
    if (block) return block.from + 1;
  }
  if (place.text) {
    for (const block of blocks) {
      const at = locatePlainText(doc, block.from, block.to, place.text);
      if (at) return at.from;
    }
  }
  if (place.heading) {
    const want = place.heading.trim().toLowerCase();
    const heading = blocks.find(
      (b) =>
        b.kind === "heading" &&
        b.markdown
          .replace(/^#+\s*/, "")
          .trim()
          .toLowerCase() === want,
    );
    if (heading) return heading.from + 1;
  }
  if (typeof place.line === "number") {
    // Markdown lines, as metadata and the outline count them.
    let line = 0;
    for (const block of blocks) {
      const lines = block.markdown.split("\n").length;
      if (place.line < line + lines) return block.from + 1;
      line += lines + 1;
    }
    return blocks.length ? blocks[blocks.length - 1].from + 1 : null;
  }
  return null;
}

/** Puts the caret at `place` and scrolls it into view; false when it
 *  isn't found. */
export function revealPlace(ctx: Ctx, place: DocumentPlace): boolean {
  const view = ctx.get(editorViewCtx);
  const pos = findPlace(ctx, view.state.doc, place);
  if (pos === null) return false;
  const $pos = view.state.doc.resolve(
    Math.min(pos, view.state.doc.content.size),
  );
  const selection = $pos.parent.inlineContent
    ? TextSelection.create(view.state.doc, $pos.pos)
    : Selection.near($pos);
  view.dispatch(view.state.tr.setSelection(selection).scrollIntoView());
  view.focus();
  return true;
}

/** The selection's plain text, for onDidChangeSelection. */
export function selectionText(ctx: Ctx): string {
  const { state } = ctx.get(editorViewCtx);
  const { from, to } = state.selection;
  return state.doc.textBetween(from, to, "\n");
}

/** A short name for the document's version: changes whenever its text
 *  does. */
export function documentRevision(markdown: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < markdown.length; i++) {
    h ^= markdown.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return `${markdown.length}-${(h >>> 0).toString(36)}`;
}

/**
 * The document made to read `markdown`, as one undo step: only the blocks
 * that differ are rewritten, so the caret stays.
 */
export function replaceDocument(ctx: Ctx, markdown: string): boolean {
  const view = ctx.get(editorViewCtx);
  const parsed = parseMarkdownSource(ctx, markdown);
  if (!parsed || typeof parsed === "string") return false;
  const doc = view.state.doc;
  const before = doc.content;
  const after = parsed.content;
  let start = 0;
  while (
    start < before.childCount &&
    start < after.childCount &&
    before.child(start).eq(after.child(start))
  )
    start++;
  let endBefore = before.childCount;
  let endAfter = after.childCount;
  while (
    endBefore > start &&
    endAfter > start &&
    before.child(endBefore - 1).eq(after.child(endAfter - 1))
  ) {
    endBefore--;
    endAfter--;
  }
  if (start === endBefore && start === endAfter) return true;
  let from = 0;
  for (let i = 0; i < start; i++) from += before.child(i).nodeSize;
  let to = from;
  for (let i = start; i < endBefore; i++) to += before.child(i).nodeSize;
  const nodes = [];
  for (let i = start; i < endAfter; i++) nodes.push(after.child(i));
  const tr = view.state.tr.replaceWith(from, to, nodes);
  closeHistory(tr);
  view.dispatch(markChangeSource(tr, "plugin"));
  return true;
}
