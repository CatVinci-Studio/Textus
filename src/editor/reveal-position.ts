import type { EditorView } from "@milkdown/kit/prose/view";
import { animate, duration, glideScroll } from "../ui/motion";
import { drawAround } from "./lazy-blocks/lazy-blocks-drawer";
import { unfoldRange } from "./html/details-fold";

/**
 * What every way to a place in the document does before it scrolls there:
 * opens the folded <details> around `from`-`to`, where it has no place on
 * screen, and draws it if a long document left it undrawn, kept drawn for
 * the `glideMs` of the scroll.
 */
export function makeReachable(
  view: EditorView,
  from: number,
  to: number,
  glideMs: number,
) {
  unfoldRange(view, from, to);
  drawAround(view, from, glideMs);
}

/**
 * Brings `pos` into view in one eased stroke of fixed length (the browser's
 * smooth scroll crawled on long ways) and pulses its block once. A link's
 * target lands a third of the way down, where reading starts, and doesn't
 * move when already in view; `top` (the outline) puts its block at the top,
 * below the window bar, so the section reads from there.
 */
export function revealPosition(
  view: EditorView,
  pos: number,
  place: "third" | "top" = "third",
) {
  const scroller = view.dom.closest<HTMLElement>(".editor-scroll");
  makeReachable(view, pos, pos, duration("--dur-sheet"));
  const { node } = view.domAtPos(pos);
  const block = (
    node instanceof Element ? node : node.parentElement
  )?.closest<HTMLElement>(".ProseMirror > *");
  if (scroller) {
    const box = scroller.getBoundingClientRect();
    if (place === "top" && block) {
      const margin = parseFloat(getComputedStyle(block).scrollMarginTop) || 0;
      glideScroll(
        scroller,
        block.getBoundingClientRect().top - box.top - margin,
      );
    } else {
      const at = view.coordsAtPos(pos);
      if (at.top < box.top || at.bottom > box.bottom)
        glideScroll(scroller, at.top - (box.top + box.height / 3));
    }
  }
  if (!block) return;
  // Animated, never a class: a class on ProseMirror's DOM reads as an edit,
  // redrawing the block and replaying its revisions' entrances. Restarted if
  // it is still pulsing.
  for (const running of block.getAnimations?.() ?? [])
    if (running.id === "reveal-pulse") running.cancel();
  const accent = getComputedStyle(block)
    .getPropertyValue("--doc-accent")
    .trim();
  animate(
    block,
    [
      {
        backgroundColor: `color-mix(in srgb, ${accent || "currentColor"} 20%, transparent)`,
      },
      {},
    ],
    {
      duration: duration("--dur-base") * 4,
      easing: "--ease-out",
      id: "reveal-pulse",
    },
  );
}
