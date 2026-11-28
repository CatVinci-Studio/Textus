import { useEffect, type RefObject } from "react";
import "./scroll-veil.css";

/**
 * Marks a .tx-scroll-fade scroller with the edges it has more past
 * (data-more-up/-down, or -left/-right across): those edges fade out
 * (controls.css), so a list that goes on reads as going on. Until the
 * returned function stops it.
 */
export function watchScrollFade(
  el: HTMLElement,
  axis: "x" | "y" = "y",
): () => void {
  const [before, after] =
    axis === "y"
      ? ["data-more-up", "data-more-down"]
      : ["data-more-left", "data-more-right"];
  const mark = () => {
    const at = axis === "y" ? el.scrollTop : el.scrollLeft;
    const room =
      axis === "y"
        ? el.scrollHeight - el.clientHeight
        : el.scrollWidth - el.clientWidth;
    el.toggleAttribute(before, at > 1);
    el.toggleAttribute(after, at < room - 1);
  };
  mark();
  el.addEventListener("scroll", mark, { passive: true });
  const resized = new ResizeObserver(mark);
  resized.observe(el);
  const changed = new MutationObserver(mark);
  changed.observe(el, { childList: true });
  return () => {
    el.removeEventListener("scroll", mark);
    resized.disconnect();
    changed.disconnect();
    el.removeAttribute(before);
    el.removeAttribute(after);
  };
}

/** watchScrollFade on `ref`'s element while `on`. */
export function useScrollFade(
  ref: RefObject<HTMLElement | null>,
  axis: "x" | "y" = "y",
  on = true,
): void {
  useEffect(() => {
    const el = ref.current;
    if (!el || !on) return;
    return watchScrollFade(el, axis);
  }, [ref, axis, on]);
}
