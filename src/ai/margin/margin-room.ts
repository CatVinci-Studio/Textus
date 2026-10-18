import { useSyncExternalStore } from "react";

/** A card's width and the air between it and the text. */
export const CARD_WIDTH = 232;
export const GAP = 28;
/** The least the text column keeps on its left when it moves over. */
const MIN_LEFT = 16;

export interface MarginRoom {
  /** Where the column's left edge sits on its own, centred. */
  natural: number;
  /** The text's right edge, in the scroller's coordinates. */
  textRight: number;
  /** How far the column moves left to open the margin. */
  shift: number;
  /** Whether a margin is available at all, even with the column moved
   *  over. */
  available: boolean;
}

/**
 * Whether the editor has room for the margin, and how far the text column
 * moves over to make it - from the scroller's width, the column's, and the
 * column's padding round the text. The one place this is decided: the
 * margin lays its cards out by it, and the review bar and Settings offer
 * the margin views only when it is available.
 */
export function marginRoom(
  scrollWidth: number,
  columnWidth: number,
  padding: number,
): MarginRoom {
  const natural = Math.max(0, (scrollWidth - columnWidth) / 2);
  // The text's right edge sits inside the column's padding.
  const textRight = natural + columnWidth - padding / 2;
  const room = scrollWidth - textRight;
  const need = CARD_WIDTH + GAP + 16;
  const shift = room < need ? need - room : 0;
  return {
    natural,
    textRight,
    shift,
    available: natural + padding / 2 - shift >= MIN_LEFT,
  };
}

// Whether the active document has room for a margin right now, for the
// surfaces outside it (Settings). A window shows one document at a time,
// so one value per window; before any document has measured, the margin
// is assumed to fit.
let available = true;
const listeners = new Set<() => void>();

export function setMarginAvailable(value: boolean) {
  if (value === available) return;
  available = value;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useMarginAvailable(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => available,
    () => true,
  );
}
