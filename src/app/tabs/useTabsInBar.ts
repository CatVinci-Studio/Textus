import { useLayoutEffect, type RefObject } from "react";
import { scaledPx } from "../../ui/chrome-scale";

/** Air kept between the tabs and the window bar's own controls. */
const AIR = 8;

/**
 * With two or more documents the tabs take the window bar's row
 * (design-language.md 5.7). The bar's controls stay where they are - the
 * window's buttons and the sidebar's at its start, the status at its end -
 * so the tabs keep clear of them: how far each end of the pane's tab row
 * is overlapped is set on the pane as --tabs-inset-start/-end. The first
 * tab starts at the sheet's edge where the controls leave it room
 * (data-tabs-at-corner: the sheet squares that corner and the tab's side
 * runs straight up from it), else past both the controls and the sheet's
 * rounded corner and the tab's own curve in, so the two curves never meet.
 */
export function useTabsInBar(pane: RefObject<HTMLElement | null>) {
  useLayoutEffect(() => {
    const main = pane.current;
    if (!main) return;
    let frame = 0;
    const measure = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const box = main.getBoundingClientRect();
        // The last of the bar's leading controls (the menu, then the
        // sidebar's toggle).
        const leadEnd = Math.max(
          0,
          ...[
            ...document.querySelectorAll(
              ".window-bar-sidebar-toggle, .window-menu-button",
            ),
          ].map((el) => el.getBoundingClientRect().right),
        );
        const status = document.querySelector(".window-bar-status");
        const air = scaledPx(AIR);
        const statusStart = status?.firstElementChild
          ? status.getBoundingClientRect().left
          : window.innerWidth;
        const style = getComputedStyle(main);
        // The sheet's edge, and its corner's radius, in the pane.
        const sheet = parseFloat(style.paddingLeft) || 0;
        // Past the corner's curve, and the tab's own curve in beside it.
        const corner =
          (parseFloat(style.getPropertyValue("--shape-m")) || 0) +
          (parseFloat(style.getPropertyValue("--shape-s")) || 0);
        const clear = leadEnd + air - box.left;
        const flush = clear <= sheet;
        const start = flush ? sheet : Math.max(clear, sheet + corner);
        main.style.setProperty("--tabs-inset-start", `${start}px`);
        main.toggleAttribute("data-tabs-at-corner", flush);
        main.style.setProperty(
          "--tabs-inset-end",
          `${Math.max(air, box.right - statusStart + air)}px`,
        );
      });
    };
    measure();
    const resized = new ResizeObserver(measure);
    resized.observe(main);
    const status = document.querySelector(".window-bar-status");
    if (status) resized.observe(status);
    window.addEventListener("resize", measure);
    // The pane slides with the sidebar and the AI panel.
    document.addEventListener("transitionend", measure);
    return () => {
      cancelAnimationFrame(frame);
      resized.disconnect();
      window.removeEventListener("resize", measure);
      document.removeEventListener("transitionend", measure);
    };
  }, [pane]);
}
