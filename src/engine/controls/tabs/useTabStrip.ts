import { useCallback, useEffect, useId, useLayoutEffect, useRef } from "react";
import { animate } from "../../motion/motion";
import { frameClock, type FramePart } from "../../frame/clock";
import { dropStripPlaces, setStripPlaces, stripOrigin } from "./tab-strips";
import {
  dragSlots,
  incomingSlots,
  moved,
  stripLength,
  stripSlots,
  type Slot,
} from "./tab-strip";

/** The key the pill riding in from another window is placed by. */
export const INCOMING = "\u0000incoming";

/**
 * A row's tabs placed by the window's clock from their widths: a tab
 * opened, closed or moved, and the others slide to their new places on the
 * same frames as the islands. Nothing is measured: the places are numbers
 * (tab-strip.ts), the gestures only change them.
 */
export function useTabStrip({
  strip,
  pane,
  ids,
  widths,
  gap,
  incomingX,
}: {
  strip: React.RefObject<HTMLElement | null>;
  /** Its pane (null: a row of no island), for a drag to find its tabs. */
  pane: string | null;
  ids: readonly string[];
  /** The tabs' widths, the incoming one's last while it rides in; null
   *  until the row is measured. */
  widths: readonly number[] | null;
  gap: number;
  /** The incoming tab's centre, in the viewport; null when none. */
  incomingX: number | null;
}) {
  const name = `strip:${useId()}`;
  const keyOf = useCallback((id: string) => `${name}:${id}`, [name]);
  const refs = useRef(new Map<string, (el: HTMLElement | null) => void>());
  const was = useRef<{ ids: readonly string[]; incoming: Slot | null }>({
    ids,
    incoming: null,
  });
  const dragging = useRef<{ at: number; to: number } | null>(null);
  /** The strip's start in the viewport, as a tab rides in. */
  const startAt = useRef<number | null>(null);
  const scrolled = useCallback(
    () => strip.current?.parentElement?.scrollLeft ?? 0,
    [strip],
  );

  const lay = useCallback(
    (slots: readonly Slot[], order: readonly string[], animated: boolean) => {
      const parts = new Map<string, FramePart>();
      order.forEach((id, i) => {
        const slot = slots[i];
        if (slot) parts.set(keyOf(id), { rect: box(slot), along: true });
      });
      parts.set(name, {
        rect: box({ x: 0, w: stripLength(slots) }),
        along: true,
      });
      frameClock.set(name, parts, { x: 0, y: 0 }, animated);
    },
    [keyOf, name],
  );

  const tabWidths = widths?.slice(0, ids.length) ?? null;

  useLayoutEffect(() => {
    if (!widths || !tabWidths) return;
    const slots = stripSlots(tabWidths, gap);
    setStripPlaces(pane, { ids, slots, scrolled });
    // Tabs gone from the row let go of their refs.
    for (const id of refs.current.keys())
      if (id !== INCOMING && !ids.includes(id)) refs.current.delete(id);
    const before = was.current;
    const changed = before.ids.join("\n") !== ids.join("\n");
    if (incomingX !== null && widths.length > ids.length) {
      startAt.current ??= (stripOrigin(pane) ?? 0) - scrolled();
      const ride = incomingSlots(
        slots,
        widths[ids.length]!,
        incomingX - startAt.current,
        gap,
      );
      lay([...ride.slots, ride.incoming], [...ids, INCOMING], true);
      // It rides on the pointer: no slide of its own.
      frameClock.place(keyOf(INCOMING), box(ride.incoming));
      was.current = { ids, incoming: ride.incoming };
      return;
    }
    startAt.current = null;
    // Let go over the row: the tab that arrived starts where it was drawn.
    const arrived =
      before.incoming && ids.find((id) => !before.ids.includes(id));
    if (arrived) frameClock.place(keyOf(arrived), box(before.incoming!));
    lay(slots, ids, changed || !!before.incoming);
    for (const id of ids)
      if (changed && !arrived && !before.ids.includes(id) && before.ids.length)
        popIn(strip.current, keyOf(id));
    was.current = { ids, incoming: null };
    // tabWidths is widths' head: the join keeps the effect to real changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ids.join("\n"), widths?.join(","), gap, incomingX, lay, keyOf, pane]);

  useEffect(() => () => frameClock.drop(name), [name]);
  useEffect(() => () => dropStripPlaces(pane, scrolled), [pane, scrolled]);

  /** The ref placing tab `id`'s pill. */
  const attach = useCallback(
    (id: string) => {
      let ref = refs.current.get(id);
      if (!ref) {
        ref = (el) => {
          el?.setAttribute("data-strip-key", keyOf(id));
          frameClock.attach(keyOf(id), el);
        };
        refs.current.set(id, ref);
      }
      return ref;
    },
    [keyOf],
  );

  /** The strip's own ref: placed by the clock, and what its tabs are
   *  found in. */
  const stripRef = useCallback(
    (el: HTMLElement | null) => {
      strip.current = el;
      frameClock.attach(name, el);
    },
    [name, strip],
  );

  /** Tab `id` dragged `dx` along: the others make room as it passes. */
  const dragTo = useCallback(
    (id: string, dx: number) => {
      if (!tabWidths) return;
      const at = ids.indexOf(id);
      const drag = dragSlots(stripSlots(tabWidths, gap), at, dx, gap);
      if (dragging.current?.to === drag.to) return;
      dragging.current = { at, to: drag.to };
      lay(drag.slots, ids, true);
    },
    [ids, tabWidths, gap, lay],
  );

  /** Let go `dx` along: the tab glides from there into the place it
   *  passed into, which is returned (its index among the others). */
  const dragEnd = useCallback(
    (id: string, dx: number): number => {
      dragging.current = null;
      const at = ids.indexOf(id);
      if (!tabWidths || at < 0) return at;
      const slots = stripSlots(tabWidths, gap);
      const { to } = dragSlots(slots, at, dx, gap);
      frameClock.place(
        keyOf(id),
        box({ x: slots[at]!.x + dx, w: slots[at]!.w }),
      );
      const order = moved(ids, at, to);
      lay(stripSlots(moved(tabWidths, at, to), gap), order, true);
      return to;
    },
    [ids, tabWidths, gap, keyOf, lay],
  );

  /** Where tab `id` lies along the strip, as laid out. */
  const slotOf = useCallback(
    (id: string): Slot | null => {
      const at = ids.indexOf(id);
      return tabWidths && at >= 0 ? stripSlots(tabWidths, gap)[at]! : null;
    },
    [ids, tabWidths, gap],
  );

  return { attach, stripRef, dragTo, dragEnd, slotOf };
}

function box(slot: Slot) {
  return { x: slot.x, y: 0, w: slot.w, h: 0 };
}

/** A tab new to the row grows in where the others made room for it. */
function popIn(strip: HTMLElement | null, key: string) {
  const el = strip?.querySelector<HTMLElement>(
    `[data-strip-key="${CSS.escape(key)}"]`,
  );
  if (el)
    animate(
      el,
      [
        { opacity: 0, scale: "var(--scale-enter)" },
        { opacity: 1, scale: "1" },
      ],
      { duration: "--dur-base", easing: "--ease-out" },
    );
}
