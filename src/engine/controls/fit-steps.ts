import { useLayoutEffect, type RefObject } from "react";
import { onAppearance } from "../tokens/appearance";

/**
 * A bar that gives way as its room shrinks: `data-fit` set to the first of
 * `steps` (looser to tighter, "" for as drawn) at which nothing in `el`
 * overflows it, and the stylesheet says what each step drops. Read again
 * as its container resizes, its contents change or the interface restyles.
 */
export function useFitSteps(
  el: RefObject<HTMLElement | null>,
  steps: readonly string[],
): void {
  const key = steps.join(" ");
  useLayoutEffect(() => {
    const bar = el.current;
    if (!bar) return;
    const all = key.split(" ");
    const fit = () => {
      for (const step of ["", ...all]) {
        bar.dataset.fit = step;
        if (bar.scrollWidth <= bar.clientWidth) return;
      }
    };
    fit();
    const resized = new ResizeObserver(fit);
    resized.observe(bar.offsetParent ?? bar);
    const changed = new MutationObserver(fit);
    changed.observe(bar, {
      childList: true,
      subtree: true,
      characterData: true,
    });
    const restyled = onAppearance(fit);
    return () => {
      resized.disconnect();
      changed.disconnect();
      restyled();
    };
  }, [el, key]);
}
