import { scaledPx } from "../../engine/tokens/chrome-scale";
import { useSyncExternalStore } from "react";
import { createSubscribers } from "../../utils/store";

/** A card's width and the air between it and the text. */
export const CARD_WIDTH = 256;
export const GAP = 30;
/** The least the text column keeps on its left when it moves over. */
const MIN_LEFT = 18;
/** The air kept between a card and the editor's right edge. */
const RIGHT_EDGE = 18;
/** Widths read back from the layout are a hair off whole pixels: a column
 *  sized to fit exactly must still fit. */
const SUBPIXEL = 0.5;

interface MarginRoom {
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

/** Whether the editor has room for the margin, and how far the text column
 *  moves over to make it. The one place this is decided. */
export function marginRoom(
  scrollWidth: number,
  columnWidth: number,
  padding: number,
): MarginRoom {
  const natural = Math.max(0, (scrollWidth - columnWidth) / 2);
  // The text's right edge sits inside the column's padding.
  const textRight = natural + columnWidth - padding / 2;
  const room = scrollWidth - textRight;
  const need = scaledPx(CARD_WIDTH + GAP + RIGHT_EDGE);
  const shift = room < need ? need - room : 0;
  return {
    natural,
    textRight,
    shift,
    available: natural + padding / 2 - shift >= MIN_LEFT - SUBPIXEL,
  };
}

/** The share of its own width the column keeps when it narrows for cards:
 *  its own width already follows the window, the theme and the zoom. */
export const NARROWEST_SHARE = 0.8;

/** The widest the column may be for a margin to fit beside it in
 *  `scrollWidth`, its text inset by `padding`: wider, the column would have
 *  to move past MIN_LEFT. Null where a column of `narrowest` leaves none. */
export function columnForMargin(
  scrollWidth: number,
  padding: number,
  narrowest: number,
): number | null {
  const need = scaledPx(CARD_WIDTH + GAP + RIGHT_EDGE);
  const widest = scrollWidth + padding - need - MIN_LEFT;
  return widest >= narrowest ? Math.floor(widest) : null;
}

// Whether the active document has room for a margin, for Settings. One value
// per window; assumed to fit until a document has measured.
let available = true;
const subscribers = createSubscribers();

export function setMarginAvailable(value: boolean) {
  if (value === available) return;
  available = value;
  subscribers.publish();
}

const subscribe = subscribers.subscribe;

export function useMarginAvailable(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => available,
    () => true,
  );
}
