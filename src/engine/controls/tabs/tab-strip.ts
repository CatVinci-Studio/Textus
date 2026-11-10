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
