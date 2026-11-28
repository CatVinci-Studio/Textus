import { useEffect, useRef } from "react";
import { FlipOnChange, measure, play } from "./flip";

/** The rows matching `selector` in `root` that are on screen, top first:
 *  a long tree measures only what can be seen. */
function rowsInSight(root: Element | null, selector: string): Element[] {
  if (!root) return [];
  const bottom = window.innerHeight;
  const rows: Element[] = [];
  for (const row of root.querySelectorAll(selector)) {
    const box = row.getBoundingClientRect();
    if (box.top > bottom) break;
    // Hidden rows (a closed <details>) count too: they are what arrives.
    if (box.bottom >= 0 || box.height === 0) rows.push(row);
  }
  return rows;
}

/**
 * A list whose rows fold away or open under one (a folder, an outline's
 * heading, a group of pages): when `watch` changes, the rows on screen glide
 * to their new places and the rows it opened come in just under where they
 * show. Shown at once, the rows below jumped by the opened rows' height.
 * A `watch` of null is a list not filled yet: its first rows just appear.
 */
export function RowsMakeRoom({
  watch,
  root,
  rows,
}: {
  watch: unknown;
  root: () => Element | null;
  /** What a row is, inside `root`. */
  rows: string;
}) {
  const last = useRef(watch);
  useEffect(() => {
    last.current = watch;
  });
  return (
    <FlipOnChange
      watch={watch}
      still={() => last.current === null}
      targets={() => rowsInSight(root(), rows)}
      duration="--dur-base"
      easing="--ease-out"
      enters
    />
  );
}

/** Drawn: a closed <details> may lay its body out unseen, at the place it
 *  will have open. */
const seen = (el: Element) =>
  typeof el.checkVisibility === "function"
    ? el.checkVisibility()
    : el.getClientRects().length > 0;

/** The same for a change made by hand (a <details> opened): `change` runs at
 *  once, and the rows make room around what it opened or folded. */
export function makeRoomFor(
  root: Element | null,
  rows: string,
  change: () => void,
): void {
  const before = measure(rowsInSight(root, rows));
  for (const el of [...before.keys()]) if (!seen(el)) before.delete(el);
  change();
  play(before, {
    duration: "--dur-base",
    easing: "--ease-out",
    arrived: () => rowsInSight(root, rows),
  });
}
