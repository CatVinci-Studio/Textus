/**
 * Where a list's highlight goes for `key`: the arrows step and wrap around,
 * Home and End go to the ends - unless the keys belong to a text box
 * (`ends: false`). Null for any other key, or an empty list.
 */
export function listMove(
  key: string,
  at: number,
  count: number,
  ends = true,
): number | null {
  if (count === 0) return null;
  // Nothing highlighted yet: down to the first, up to the last.
  if (at < 0) at = key === "ArrowUp" ? 0 : -1;
  if (key === "ArrowDown") return (at + 1 + count) % count;
  if (key === "ArrowUp") return (at - 1 + count) % count;
  if (ends && key === "Home") return 0;
  if (ends && key === "End") return count - 1;
  return null;
}
