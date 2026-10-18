import type { EditorView } from "@milkdown/kit/prose/view";
import { scrollBehavior } from "../ui/motion";

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
  block.classList.remove("reveal-pulse");
  // Restarted, if it was still pulsing from a click a moment ago.
  void block.offsetWidth;
  block.classList.add("reveal-pulse");
  const done = () => block.classList.remove("reveal-pulse");
  block.addEventListener("animationend", done, { once: true });
  window.setTimeout(done, 1000);
}
