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
  /** Of `fixed`, what its name may use: a × hidden till the tab opens. */
  spare?: number;
  /** The open tab: squeezed, it keeps its name before the others. */
  open?: boolean;
}

interface TabLimits {
  /** The narrowest and the widest a tab may be. */
  min: number;
  max: number;
  /** False where tabs keep their width and the row scrolls (a phone's). */
  shrink?: boolean;
  /** The least of its name a squeezed tab still shows: below that the row
   *  scrolls rather than show tabs that say nothing. */
  fewest?: number;
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
 * share keeps its own width, the rest going to the others; the open tab
 * first keeps what it needs, while the others can still show a few letters.
 */
export function tabWidths(
  tabs: readonly TabParts[],
  { min, max, shrink = true, fewest = 0 }: TabLimits,
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
  const sum = (ws: readonly number[]) => ws.reduce((a, w) => a + w, 0);
  // At its least a tab shows `fewest` of its name: one whose × is hidden
  // gives its name that room too.
  const floor = tabs.map((tab, i) =>
    Math.min(
      wanted[i]!,
      Math.max(
        min,
        tab.fixed -
          (tab.open ? 0 : (tab.spare ?? 0)) +
          Math.min(tab.title, fewest),
      ),
    ),
  );
  const squeeze = shrink && sum(wanted) > room;
  const even = squeeze ? shareLevel(wanted, room, floor) : Infinity;
  const open = squeeze ? tabs.findIndex((tab) => tab.open) : -1;
  const others = (ws: readonly number[]) => ws.filter((_, i) => i !== open);
  // What the open tab keeps: its want, less what the others need at their
  // least, never under its even share; when even their least overflows the
  // row, which scrolls then, its whole want.
  const left = room - sum(others(floor));
  const kept =
    open < 0
      ? 0
      : left < floor[open]!
        ? Math.min(wanted[open]!, shown)
        : Math.max(
            floor[open]!,
            Math.min(wanted[open]!, even),
            Math.min(wanted[open]!, shown, left),
          );
  const level =
    open < 0 ? even : shareLevel(others(wanted), room - kept, others(floor));
  const squeezed = wanted.map((width, i) =>
    i === open ? kept : Math.max(floor[i]!, Math.min(width, level)),
  );
  const capped = squeezed.map((width) => Math.min(width, shown));
  // Capped to what shows beside the list they may fit after all: then
  // there is no list, and a tab may take the whole row.
  const overflow = sum(capped) > room + SLACK;
  const widths = overflow
    ? capped
    : squeezed.map((width) => Math.min(width, room));
  return {
    widths,
    cut: tabs.map(
      (tab, i) => tab.title > widths[i]! - tab.fixed + (tab.spare ?? 0) + SLACK,
    ),
    overflow,
  };
}

/** The width no tab goes over so that together they take `room`: those
 *  that want less keep theirs, and those whose least is more keep that
 *  (a padlock's or a dot's tab), the rest sharing what they leave. Whole
 *  px, so the tabs' edges stay sharp. */
function shareLevel(
  wanted: readonly number[],
  room: number,
  floor: readonly number[],
): number {
  let held = wanted.map(() => false);
  for (;;) {
    const free = wanted.filter((_, i) => !held[i]);
    // Every tab at its least: past that the row overflows.
    if (free.length === 0) return 0;
    const left = room - floor.reduce((a, f, i) => a + (held[i] ? f : 0), 0);
    const level = evenLevel(free, left);
    const next = held.map((h, i) => h || floor[i]! > level);
    if (next.every((h, i) => h === held[i])) return level;
    held = next;
  }
}

/** shareLevel without least widths. */
function evenLevel(wanted: readonly number[], room: number): number {
  const rising = [...wanted].sort((a, b) => a - b);
  let left = room;
  for (let i = 0; i < rising.length; i++) {
    const share = left / (rising.length - i);
    if (rising[i]! >= share) return Math.floor(share);
    left -= rising[i]!;
  }
  return Infinity;
}
