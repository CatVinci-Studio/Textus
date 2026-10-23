import { LOCAL_KEYS, readLocalJson, writeLocal } from "../storage/local";

/**
 * Where each file was being read when it was last shown, so it opens
 * there again (#348) - switched to from the file tree, closed and opened,
 * or restored with the session. Kept as the block at the top of the view,
 * by its place among the document's blocks, and how far into it: a
 * scrollTop moves with the window's width, a block doesn't.
 */
export interface ReadingPlace {
  block: number;
  into: number;
  /** When it was kept, for dropping the oldest past MAX. */
  at: number;
}

/** Files remembered; the least recently read go first. */
const MAX = 200;

function isPlace(value: unknown): value is ReadingPlace {
  const p = value as ReadingPlace;
  return (
    typeof p === "object" &&
    p !== null &&
    Number.isInteger(p.block) &&
    p.block >= 0 &&
    typeof p.into === "number" &&
    typeof p.at === "number"
  );
}

function places(): Record<string, ReadingPlace> {
  const raw = readLocalJson(LOCAL_KEYS.readingPlaces);
  if (typeof raw !== "object" || raw === null) return {};
  return Object.fromEntries(
    Object.entries(raw).filter(([, p]) => isPlace(p)),
  ) as Record<string, ReadingPlace>;
}

export function readingPlace(path: string): ReadingPlace | null {
  return places()[path] ?? null;
}

export function keepReadingPlace(
  path: string,
  place: Omit<ReadingPlace, "at">,
): void {
  const all = places();
  if (place.block === 0 && place.into < 1) delete all[path];
  else all[path] = { ...place, at: Date.now() };
  const kept = Object.entries(all)
    .sort(([, a], [, b]) => b.at - a.at)
    .slice(0, MAX);
  writeLocal(
    LOCAL_KEYS.readingPlaces,
    JSON.stringify(Object.fromEntries(kept)),
  );
}

/** The document's blocks, as the editor draws them - not the widgets
 *  between them. */
function blocks(root: Element): HTMLElement[] {
  return [...root.children].filter(
    (el): el is HTMLElement =>
      el instanceof HTMLElement && !el.classList.contains("ProseMirror-widget"),
  );
}

/** Where `el` starts, in the scroller's content. */
function topIn(scroller: HTMLElement, el: HTMLElement): number {
  return (
    el.getBoundingClientRect().top -
    scroller.getBoundingClientRect().top +
    scroller.scrollTop
  );
}

/** The place `scroller` shows now: its first block not wholly above it. */
export function placeIn(
  scroller: HTMLElement,
  root: Element,
): Omit<ReadingPlace, "at"> | null {
  const list = blocks(root);
  if (list.length === 0) return null;
  const top = scroller.scrollTop;
  const block = list.findIndex(
    (el) => topIn(scroller, el) + el.offsetHeight > top,
  );
  if (block < 0) return null;
  return { block, into: Math.round(top - topIn(scroller, list[block])) };
}

/** Scrolls to `place`, once the document has that many blocks; false
 *  while it hasn't (still being drawn). */
export function scrollToPlace(
  scroller: HTMLElement,
  root: Element,
  place: Omit<ReadingPlace, "at">,
): boolean {
  const el = blocks(root)[place.block];
  if (!el) return false;
  scroller.scrollTop = topIn(scroller, el) + place.into;
  return true;
}
