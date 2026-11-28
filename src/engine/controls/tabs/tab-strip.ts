import { passedCount, shiftAt } from "../../drag/row";

/**
 * Where each tab of a row lies along its strip, from their widths alone
 * (tab-widths.ts): side by side, a gap apart. A drag along the row and a
 * tab riding in from another window only change these numbers; the clock
 * moves the tabs to them.
 */

export interface Slot {
  x: number;
  w: number;
}

export function stripSlots(widths: readonly number[], gap: number): Slot[] {
  let x = 0;
  return widths.map((w) => {
    const slot = { x, w };
    x += w + gap;
    return slot;
  });
}

/** A row as laid out: its tabs, their widths, and the room and gap they
 *  were fitted to. */
export interface RowShape {
  ids: readonly string[];
  widths: readonly number[];
  room: number;
  gap: number;
}

/** Whether a row's new places slide on the clock rather than land at once:
 *  tabs came, went or moved, or a tab's own width changed (a new name, a
 *  dot) while every tab had the width its name asks for - landed at once,
 *  it and every tab after it jumped. Tabs squeezed to the room follow it in
 *  the same frame as it changes (the window, an island sliding). */
export function slides(was: RowShape, now: RowShape): boolean {
  if (was.ids.join("\n") !== now.ids.join("\n")) return true;
  const resized = now.widths.some(
    (w, i) => Math.abs(w - (was.widths[i] ?? w)) >= 0.5,
  );
  return resized && roomy(was) && roomy(now);
}

/** Every tab at its own width: the row ends short of its room. */
function roomy(row: RowShape): boolean {
  return stripLength(stripSlots(row.widths, row.gap)) < row.room - 0.5;
}

/** The strip's length: its last tab's end. */
export function stripLength(slots: readonly Slot[]): number {
  const last = slots[slots.length - 1];
  return last ? last.x + last.w : 0;
}

const centersOf = (slots: readonly Slot[]) =>
  slots.map((slot) => slot.x + slot.w / 2);

/**
 * Tab `at` dragged `dx` along: where it would land among the others, and
 * their places as they make room for it. Its own slot stays where it was:
 * the pointer carries it.
 */
export function dragSlots(
  slots: readonly Slot[],
  at: number,
  dx: number,
  gap: number,
): { slots: Slot[]; to: number } {
  const mine = slots[at];
  if (!mine) return { slots: [...slots], to: at };
  const others = slots.filter((_, i) => i !== at);
  const to = passedCount(centersOf(others), mine.x + mine.w / 2 + dx);
  const room = mine.w + gap;
  let i = 0;
  return {
    to,
    slots: slots.map((slot, j) =>
      j === at ? slot : { ...slot, x: slot.x + shiftAt(i++, at, to, room) },
    ),
  };
}

/** Tab `from` moved to `to` among the others: the row's new order. */
export function moved<T>(items: readonly T[], from: number, to: number): T[] {
  const rest = items.filter((_, i) => i !== from);
  rest.splice(to, 0, items[from]!);
  return rest;
}

/**
 * A tab `w` wide riding in centred on `x`: the place it would take, the
 * tabs past it moved on to make room, and where it is drawn (on the
 * pointer, kept inside the strip).
 */
export function incomingSlots(
  slots: readonly Slot[],
  w: number,
  x: number,
  gap: number,
): { slots: Slot[]; at: number; incoming: Slot } {
  const at = passedCount(centersOf(slots), x);
  const end = stripLength(slots) + (slots.length ? gap : 0);
  return {
    at,
    slots: slots.map((slot, i) =>
      i >= at ? { ...slot, x: slot.x + w + gap } : slot,
    ),
    incoming: { x: Math.max(0, Math.min(end, x - w / 2)), w },
  };
}

/**
 * Where a row scrolled to `from`, `shown` long, scrolls to bring `slot`
 * into view, or null where it is. Scrolled, the row's start fades over
 * `fade` (island.css): the tab stands clear of it, as far as there's room,
 * with `air` either side. A touch row, with neither, shows no part of the
 * tab before it.
 */
export function revealAt(
  slot: Slot,
  from: number,
  shown: number,
  fade: number,
  air = 12,
): number | null {
  // Room either side of it, as much as there is.
  const margin = Math.max(0, Math.min(air, (shown - slot.w) / 2));
  const lead = Math.max(margin, Math.min(fade, shown - slot.w));
  const start = Math.max(0, slot.x - lead);
  if (slot.x - from < (from > 0 ? lead : margin)) return start;
  if (slot.x + slot.w > from + shown - margin)
    return Math.min(start, slot.x + slot.w - shown + margin);
  return null;
}

/** The room a touch row needs after its tabs, which end at `end`, to
 *  scroll to `left` with `shown` of it in view: none while it can. Without
 *  it the row stops short of the end-most tabs' starts, a slice of the tab
 *  before them showing. */
export function tailFor(left: number, end: number, shown: number): number {
  return Math.max(0, Math.ceil(left + shown - end));
}

/** `left` moved on to the start of the first tab at or after it, never past
 *  `limit` (the open tab's start): a touch row then shows no part of a tab
 *  at its start. `edges` are the tabs' starts. */
export function snapToTab(
  left: number,
  edges: readonly number[],
  limit: number,
): number {
  const next = edges.find((x) => x >= left - 0.5 && x <= limit);
  return next ?? left;
}
