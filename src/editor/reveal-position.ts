import type { EditorView } from "@milkdown/kit/prose/view";
import { animate, duration, glideScroll } from "../ui/motion";
import { drawAround } from "./lazy-blocks/lazy-blocks-drawer";

/**
 * Brings `pos` into view in one eased stroke of fixed length (the browser's
 * smooth scroll crawled on long ways) and pulses its block once. Already in
 * view, nothing moves.
 */
export function revealPosition(view: EditorView, pos: number) {
  const scroller = view.dom.closest<HTMLElement>(".editor-scroll");
  // In a long document `pos` may be out of sight, not yet drawn.
  drawAround(view, pos, duration("--dur-sheet"));
  const at = view.coordsAtPos(pos);
  if (scroller) {
    const box = scroller.getBoundingClientRect();
    if (at.top < box.top || at.bottom > box.bottom)
      // A third of the way down, where reading starts.
      glideScroll(scroller, at.top - (box.top + box.height / 3));
  }
  const { node } = view.domAtPos(pos);
  const block = (
    node instanceof Element ? node : node.parentElement
  )?.closest<HTMLElement>(".ProseMirror > *");
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
