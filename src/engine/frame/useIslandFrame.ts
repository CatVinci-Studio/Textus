import { useLayoutEffect, useRef, type RefObject } from "react";
import { frameClock } from "./clock";
import { islandParts, type PlacedIsland } from "./island-parts";
import type { IslandsLayout } from "./solve";
import type { IslandRoom } from "./useIslandRoom";
import type { Rect } from "./rect";

/** Something held by the pointer moves with it, not after it. */
const GRIPPED = ".tx-grip[data-gripped], .sidebar-resizer[data-gripped]";

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
  after: () => void,
): void {
  const last = useRef<{ shell: IslandRoom["shell"]; sign: string } | null>(
    null,
  );
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
    const sign = [...parts]
      .map(([k, p]) => `${k}:${p.rect.x},${p.rect.y},${p.rect.w},${p.rect.h}`)
      .join(" ");
    const was = last.current;
    if (was?.sign === sign) return;
    const resized =
      was && (was.shell.w !== room.shell.w || was.shell.h !== room.shell.h);
    const animate = !!was && !resized && !document.querySelector(GRIPPED);
    last.current = { shell: room.shell, sign };
    frameClock.set("islands", parts, room.origin, animate);
    after();
  });
}
