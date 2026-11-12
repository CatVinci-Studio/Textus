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

/**
 * A row that keeps as many of its items (`[data-fit-item]`) as fit, in
 * order, and folds the rest, from its end, behind `more` (a selector in
 * it): `data-fit-hidden` on each folded one, and on `more` while nothing
 * is. Read again as its container resizes or the interface restyles.
 */
export function useFitItems(
  el: RefObject<HTMLElement | null>,
  more: string,
): void {
  useLayoutEffect(() => {
    const row = el.current;
    if (!row) return;
    const fit = () => {
      const items = [...row.querySelectorAll<HTMLElement>("[data-fit-item]")];
      const button = row.querySelector<HTMLElement>(more);
      for (const item of items) item.removeAttribute("data-fit-hidden");
      button?.setAttribute("data-fit-hidden", "");
      if (row.scrollWidth <= row.clientWidth) return;
      button?.removeAttribute("data-fit-hidden");
      for (let i = items.length - 1; i >= 0; i--) {
        if (row.scrollWidth <= row.clientWidth) return;
        items[i].setAttribute("data-fit-hidden", "");
      }
    };
    fit();
    const resized = new ResizeObserver(fit);
    resized.observe(row.offsetParent ?? row);
    const restyled = onAppearance(fit);
    return () => {
      resized.disconnect();
      restyled();
    };
  }, [el, more]);
}
