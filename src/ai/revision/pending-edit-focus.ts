import type { PendingPreview } from "./pending-edit-plugin";

/** The decidable previews (not streaming), in document order so "next"
 *  reads top to bottom. */
export function orderForReview(previews: PendingPreview[]): PendingPreview[] {
  return previews
    .filter((p) => !p.streaming)
    .slice()
    .sort((a, b) => a.from - b.from);
}

/** Where the review pointer lands after the set changed. It keeps its index,
 *  so deciding one moves to the next instead of back to the first. */
export function nextFocusAfterChange(
  oldOrder: string[],
  oldFocus: string | null,
  newOrder: string[],
): string | null {
  if (newOrder.length === 0) return null;
  if (oldFocus !== null && newOrder.includes(oldFocus)) return oldFocus;

  const oldIndex = oldFocus === null ? -1 : oldOrder.indexOf(oldFocus);
  if (oldIndex === -1) return newOrder[0];

  const clamped = Math.min(oldIndex, newOrder.length - 1);
  return newOrder[clamped];
}
