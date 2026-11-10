import { useLayoutEffect, type RefObject } from "react";
import { FlipOnChange } from "../../ui/flip";
import { markIslandsReady } from "../../ui/Island";

/**
 * The islands' motion in their area: once the window's first layout is up,
 * an island made after it plays its entrance (island.css); whenever the
 * layout (`layout`, a key of its grid and panes) changes, every island, row
 * and pane slides from its old place to its new one.
 */
export function IslandMotion({
  layout,
  area,
}: {
  layout: string;
  area: RefObject<HTMLElement | null>;
}) {
  useLayoutEffect(() => markIslandsReady(), []);
  return (
    <FlipOnChange
      watch={layout}
      targets={() =>
        area.current?.querySelectorAll(
          ":scope > :is([data-island], .island-row, .split-pane)",
        ) ?? []
      }
      duration="--dur-base"
      easing="--ease-spring"
    />
  );
}
