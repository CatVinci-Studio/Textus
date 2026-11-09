import { useEffect, useRef } from "react";
import { scaledPx } from "../ui/chrome-scale";

/** Room kept between the title and what sits beside it. */
const GAP = 12;
/** Less than this either side of the column's centre, and the title moves. */
const MIN_HALF = 80;

/**
 * The window bar's title is centred over the document column, not laid out
 * beside the status on its right (a page's path, the word count): this
 * keeps it from running under that status, as wide as twice the room from
 * its centre to the status, so a long name is cut short with an ellipsis.
 */
export function useTitleRoom() {
  const titleRef = useRef<HTMLSpanElement>(null);
  const statusRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const title = titleRef.current;
    const status = statusRef.current;
    if (!title || !status) return;
    let frame = 0;
    const measure = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const nudge = parseFloat(title.style.marginLeft) || 0;
        const box = title.getBoundingClientRect();
        // Where it would be centred, without the last nudge.
        const centre = box.left + box.width / 2 - nudge;
        const right =
          (status.firstElementChild
            ? status.getBoundingClientRect().left
            : window.innerWidth) - scaledPx(GAP);
        const half = right - centre;
        if (half >= MIN_HALF) {
          title.style.setProperty("--window-bar-title-room", `${2 * half}px`);
          title.style.marginLeft = "";
          return;
        }
        // No room either side of the column's centre (a narrow window with
        // the sidebar open): the free stretch before the status instead.
        let left = 0;
        for (
          let el = title.previousElementSibling;
          el;
          el = el.previousElementSibling
        )
          left = Math.max(
            left,
            el.getBoundingClientRect().right + scaledPx(GAP),
          );
        const span = Math.max(0, right - left);
        title.style.setProperty("--window-bar-title-room", `${span}px`);
        title.style.marginLeft = `${left + span / 2 - centre}px`;
      });
    };
    measure();
    const resized = new ResizeObserver(measure);
    resized.observe(status);
    resized.observe(title.parentElement ?? title);
    const changed = new MutationObserver(measure);
    changed.observe(status, {
      childList: true,
      subtree: true,
      characterData: true,
    });
    // The title slides with the sidebar and the AI panel.
    title.addEventListener("transitionend", measure);
    window.addEventListener("resize", measure);
    return () => {
      cancelAnimationFrame(frame);
      resized.disconnect();
      changed.disconnect();
      title.removeEventListener("transitionend", measure);
      window.removeEventListener("resize", measure);
    };
  }, []);
  return { titleRef, statusRef };
}
