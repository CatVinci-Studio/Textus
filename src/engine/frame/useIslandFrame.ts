import { useLayoutEffect, useRef, type RefObject } from "react";
import { gripHeld } from "./grip";
import { frameClock } from "./clock";
import { islandParts, type PlacedIsland } from "./island-parts";
import type { IslandsLayout } from "./solve";
import type { IslandRoom } from "./useIslandRoom";
import type { Rect } from "./rect";
import { setFrameLayout } from "./frame-store";

/** The room left of the islands' area (the rail, the sidebar's column),
 *  moving with them: what the sidebar is revealed by, on their frames. */
export const BEFORE_ISLANDS = "before-islands";

/**
 * Hands the islands' parts to the window's clock after each commit, before
 * the frame is drawn: they move from where they are to where the solver
 * put them. Placed at once the first time, when the window itself was
 * resized, and while a divider or the sidebar's edge is held.
 */
export function useIslandFrame(
  area: RefObject<HTMLElement | null>,
  room: IslandRoom | null,
  box: Rect | null,
  solved: IslandsLayout | null,
  islands: readonly PlacedIsland[],
): void {
  const last = useRef<{
    shell: IslandRoom["shell"];
    sign: string;
    held: string;
  } | null>(null);
  const attached = useRef(new Set<string>());
  useLayoutEffect(() => {
    const main = area.current;
    if (!main || !room || !box || !solved) return;
    const parts = islandParts(
      islands,
      solved.dividers.map((d) => ({
        path: d.line.path,
        index: d.line.index,
        rect: d.rect,
      })),
      box,
      room.origin,
    );
    parts.set(BEFORE_ISLANDS, {
      rect: { x: 0, y: 0, w: room.origin.x, h: room.shell.h },
    });
    const sign = [...parts]
      .map(([k, p]) => `${k}:${p.rect.x},${p.rect.y},${p.rect.w},${p.rect.h}`)
      .join(" ");
    // What the islands hold, which the published layout carries too.
    const held = `${room.origin.x},${room.origin.y},${room.shellAt.x},${room.shellAt.y} ${islands
      .map((i) => `${i.key}:${i.paneId}:${i.front}:${i.tabs.join(",")}`)
      .join(" ")}`;
    const was = last.current;
    // A render that moved and changed nothing (a keystroke): nothing to
    // find, publish or place.
    if (was?.sign === sign && was.held === held) return;
    // Its parts' elements, found by their keys: React draws them, the
    // clock places them.
    const found = new Set<string>();
    for (const el of main.querySelectorAll<HTMLElement>("[data-frame]")) {
      frameClock.attach(el.dataset.frame!, el);
      found.add(el.dataset.frame!);
    }
    for (const key of attached.current)
      if (!found.has(key)) frameClock.attach(key, null);
    attached.current = found;
    publish(room, box, solved, islands);
    const resized =
      was && (was.shell.w !== room.shell.w || was.shell.h !== room.shell.h);
    const animate = !!was && !resized && !gripHeld();
    last.current = { shell: room.shell, sign, held };
    frameClock.set("islands", parts, room.origin, animate);
  });
  // Gone with its area: its parts let go.
  useLayoutEffect(
    () => () => {
      for (const key of attached.current) frameClock.attach(key, null);
      frameClock.drop("islands");
    },
    [],
  );
}

/** The solve, in the viewport's pixels, for what reads the islands' places. */
function publish(
  room: IslandRoom,
  box: Rect,
  solved: IslandsLayout,
  islands: readonly PlacedIsland[],
) {
  const dx = room.origin.x + room.shellAt.x;
  const dy = room.origin.y + room.shellAt.y;
  const at = (r: Rect): Rect => ({ ...r, x: r.x + dx, y: r.y + dy });
  setFrameLayout({
    islands: islands.map(({ key, paneId, rects }) => ({
      key,
      paneId,
      row: rects.row && at(rects.row),
      sheet: at(rects.sheet),
      whole: at(rects.whole),
    })),
    dividers: solved.dividers.map((d) => {
      const by = d.line.direction === "row" ? dx : dy;
      return {
        ...d,
        rect: at(d.rect),
        before: { start: d.before.start + by, end: d.before.end + by },
        after: { start: d.after.start + by, end: d.after.end + by },
      };
    }),
    area: at(box),
    origin: { x: dx, y: dy },
  });
}
