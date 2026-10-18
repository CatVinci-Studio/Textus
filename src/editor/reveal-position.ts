import type { EditorView } from "@milkdown/kit/prose/view";
import { animate, duration, scrollBehavior } from "../ui/motion";

/**
 * Brings `pos` into view and pulses the block it is in once, so the eye
 * lands on it - for a review note's "Show in document", the review bar's
 * steps and a followed #heading link (link-click-plugin.ts). A target off the
 * screen by less than two screens is scrolled to smoothly - the movement
 * says which way it was; further away it jumps, since a long smooth scroll
 * is only a wait. Already in view, nothing moves.
 */
export function revealPosition(view: EditorView, pos: number) {
  const scroller = view.dom.closest<HTMLElement>(".editor-scroll");
  const at = view.coordsAtPos(pos);
  if (scroller) {
    const box = scroller.getBoundingClientRect();
    if (at.top < box.top || at.bottom > box.bottom) {
      // A third of the way down, where reading starts.
      const delta = at.top - (box.top + box.height / 3);
      scroller.scrollBy({
        top: delta,
        behavior: Math.abs(delta) < box.height * 2 ? scrollBehavior() : "auto",
      });
    }
  }
  const { node } = view.domAtPos(pos);
  const block = (
    node instanceof Element ? node : node.parentElement
  )?.closest<HTMLElement>(".ProseMirror > *");
  if (!block) return;
  // The accent flashes once and lets go - long enough to be found, gone
  // before it reads as a mark. Animated, never a class: the block is
  // ProseMirror's DOM, and a class written onto it reads as an edit, so
  // the block was redrawn and every revision in it replayed its entrance -
  // the new text faded in from nothing on each review bar step.
  // Restarted, if it was still pulsing from a click a moment ago.
  for (const running of block.getAnimations?.() ?? [])
    if (running.id === "reveal-pulse") running.cancel();
  const accent = getComputedStyle(block)
    .getPropertyValue("--editor-accent")
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
