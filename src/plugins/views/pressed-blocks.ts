/**
 * A plugin block a finger last pressed, marked `data-pressed` until a press
 * elsewhere: a touch screen shows its source button then, not over the
 * drawing all the time. A press inside its frame is told by the frame
 * (`tx-frame-press`): the window sees nothing of it, nor any focus in all
 * engines.
 */

export const FRAME_PRESS = "tx-frame-press";

let watching = false;

const mark = (block: Element | null) => {
  for (const el of document.querySelectorAll("[data-pressed]"))
    if (el !== block) el.removeAttribute("data-pressed");
  block?.setAttribute("data-pressed", "");
};

/** Starts marking the pressed `selector` block; once for the window. */
export function watchPressedBlocks(selector: string): void {
  if (watching) return;
  watching = true;
  document.addEventListener(FRAME_PRESS, (event) =>
    mark((event.target as Element).closest(selector)),
  );
  document.addEventListener(
    "pointerdown",
    (event) =>
      mark((event.target as Element | null)?.closest?.(selector) ?? null),
    true,
  );
}
