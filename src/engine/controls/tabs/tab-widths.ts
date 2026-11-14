/**
 * How wide each tab in a row is, from numbers alone: every tab takes the
 * room its name needs, up to the widest a tab may be; when the row can't
 * hold them the widest give way first, down to the narrowest a tab may be;
 * past that the row overflows, and scrolls.
 */

/** One tab's measures, in px. */
export interface TabParts {
  /** Its name's text. */
  title: number;
  /** Everything else in it: padding, gaps, its dot or padlock, and its
   *  ×'s room, kept whether the × shows or not. */
  fixed: number;
}

interface TabLimits {
  /** The narrowest and the widest a tab may be. */
  min: number;
  max: number;
  /** False where tabs keep their width and the row scrolls (a phone's). */
  shrink?: boolean;
}

export interface TabFit {
  widths: number[];
  /** A name that doesn't fit the room its tab leaves it. */
  cut: boolean[];
  /** The tabs don't fit the row even at their narrowest. */
  overflow: boolean;
}

/** A name this little over its room still reads whole. */
const SLACK = 0.5;

/**
 * Fits `tabs` into a row `available` px wide with `gap` px between them.
 * Squeezed, they share the row evenly and one that needs less than its
 * share keeps its own width, the rest going to the others.
 */
export function tabWidths(
  tabs: readonly TabParts[],
  { min, max, shrink = true }: TabLimits,
  available: number,
  gap = 0,
  /** What shows of the row once its tabs overflow (its end holds the list
   *  button): no tab grows wider, or the open one could never show whole. */
  shown = available,
): TabFit {
  const room = available - gap * Math.max(0, tabs.length - 1);
  const wanted = tabs.map((tab) =>
    Math.max(min, Math.min(max, tab.fixed + tab.title)),
  );
  const total = wanted.reduce((sum, width) => sum + width, 0);
  const level = shrink && total > room ? shareLevel(wanted, room) : Infinity;
  const squeezed = wanted.map((width) =>
    Math.max(Math.min(width, min), Math.min(width, level)),
  );
  const sum = (ws: readonly number[]) => ws.reduce((a, w) => a + w, 0);
  const capped = squeezed.map((width) => Math.min(width, shown));
  // Capped to what shows beside the list they may fit after all: then
  // there is no list, and a tab may take the whole row.
  const overflow = sum(capped) > room + SLACK;
  const widths = overflow
    ? capped
    : squeezed.map((width) => Math.min(width, room));
  return {
    widths,
    cut: tabs.map((tab, i) => tab.title > widths[i]! - tab.fixed + SLACK),
    overflow,
  };
}

/** The width no tab goes over so that together they take `room`: those
 *  that want less keep theirs. Whole px, so the tabs' edges stay sharp. */
function shareLevel(wanted: readonly number[], room: number): number {
  const rising = [...wanted].sort((a, b) => a - b);
  let left = room;
  for (let i = 0; i < rising.length; i++) {
    const share = left / (rising.length - i);
    if (rising[i]! >= share) return Math.floor(share);
    left -= rising[i]!;
  }
  return Infinity;
}
