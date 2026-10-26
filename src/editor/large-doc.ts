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
