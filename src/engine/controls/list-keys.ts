/**
 * Where a list's highlight goes for `key`: the arrows step and wrap around
 * (up and down a column, left and right along a `row`), Home and End go to
 * the ends - unless the keys belong to a text box (`ends: false`). Null for
 * any other key, or an empty list.
 */
export function listMove(
  key: string,
  at: number,
  count: number,
  ends = true,
  axis: "column" | "row" = "column",
): number | null {
  if (count === 0) return null;
  const [back, on] =
    axis === "row" ? ["ArrowLeft", "ArrowRight"] : ["ArrowUp", "ArrowDown"];
  // Nothing highlighted yet: on to the first, back to the last.
  if (at < 0) at = key === back ? 0 : -1;
  if (key === on) return (at + 1 + count) % count;
  if (key === back) return (at - 1 + count) % count;
  if (ends && key === "Home") return 0;
  if (ends && key === "End") return count - 1;
  return null;
}

/** The row of a menu (`rows` of `list`, the enabled ones) the keyboard's
 *  `key` moves to from the focused one; null for a key that doesn't move. */
export function menuKeyStep(
  key: string,
  list: HTMLElement | null,
  rows: string,
): HTMLElement | null {
  const all = Array.from(list?.querySelectorAll<HTMLElement>(rows) ?? []);
  const at = all.indexOf(document.activeElement as HTMLElement);
  const moved = listMove(key, at, all.length);
  return moved === null ? null : all[moved];
}
