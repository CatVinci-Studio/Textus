import type { Node as ProseNode } from "@milkdown/kit/prose/model";

// Sizes are ProseMirror's node-size: roughly the character count plus one
// per node boundary, close enough for a threshold.

/**
 * Above this size the editor draws formulas, diagrams and pictures lazily,
 * and a tab's caret is kept as a document position, not a Markdown offset.
 */
const LARGE_DOC_THRESHOLD = 100_000;

export function isLargeDoc(doc: ProseNode): boolean {
  return doc.content.size > LARGE_DOC_THRESHOLD;
}

/**
 * Above this size completion, grammar check and Mermaid's redraw on every
 * edit pause, and the window bar says so. Their work is the paragraph at the
 * caret, so only documents past the largest measured size pause them.
 */
export const PAUSE_FEATURES_THRESHOLD = 1_500_000;

export function pausesFeatures(doc: ProseNode): boolean {
  return doc.content.size > PAUSE_FEATURES_THRESHOLD;
}

/**
 * Above this size (about 150,000 characters) only the blocks near the
 * screen are drawn; the rest are placeholders of their height. Once on, it
 * stays on until the document shrinks a tenth below, so typing at the
 * threshold doesn't redraw it back and forth.
 */
const LAZY_BLOCKS_THRESHOLD = 150_000;

export function drawsLazily(doc: ProseNode): boolean {
  return doc.content.size > LAZY_BLOCKS_THRESHOLD;
}

export function keepsDrawingLazily(doc: ProseNode): boolean {
  return doc.content.size > LAZY_BLOCKS_THRESHOLD * 0.9;
}
