import type { Node as ProseNode } from "@milkdown/kit/prose/model";

// Sizes are ProseMirror's node-size: roughly the character count plus one
// per node boundary, close enough for a threshold. The numbers come from
// the large-document benchmark (npm run bench:large-doc, docs/dev/testing.md).

/**
 * Above this size the editor draws lazily: a formula, a diagram or a
 * picture off screen waits until it comes near (draw-when-visible.ts), and
 * a tab's caret is kept as a document position rather than written out as
 * a Markdown offset. Below it, everything is drawn as it always was.
 */
export const LARGE_DOC_THRESHOLD = 100_000;

export function isLargeDoc(doc: ProseNode): boolean {
  return doc.content.size > LARGE_DOC_THRESHOLD;
}

/**
 * Above this size completion, grammar check and Mermaid's redraw on every
 * edit pause, and the window bar says so. It used to be the threshold
 * above (100k) - those features walked the document on every keystroke
 * then. Measured with them on, a 5k-block document (300k) and a 20k-block
 * one (1.2M) typed, opened, scrolled and took Enter in the same time as
 * with them paused: their work is the paragraph at the caret. So only a
 * document past the largest one measured pauses them.
 */
export const PAUSE_FEATURES_THRESHOLD = 1_500_000;

export function pausesFeatures(doc: ProseNode): boolean {
  return doc.content.size > PAUSE_FEATURES_THRESHOLD;
}
