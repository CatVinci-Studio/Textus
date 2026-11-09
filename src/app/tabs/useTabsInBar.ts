import { useLayoutEffect, type RefObject } from "react";
import { scaledPx } from "../../ui/chrome-scale";

/** Air kept between the tabs and the window bar's own controls. */
const AIR = 8;

/**
 * With two or more documents the tabs take the window bar's row
 * (design-language.md 5.7). The bar's controls stay where they are - the
 * window's buttons and the sidebar's at its start, the status at its end -
 * so the tabs keep clear of them: how far each end of the pane's tab row
 * is overlapped is set on the pane as --tabs-inset-start/-end.
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
        const lead = document.querySelector(
          ".window-bar-sidebar-toggle, .window-menu-button",
        );
        const status = document.querySelector(".window-bar-status");
        const air = scaledPx(AIR);
        const leadEnd = lead ? lead.getBoundingClientRect().right : 0;
        const statusStart = status?.firstElementChild
          ? status.getBoundingClientRect().left
          : window.innerWidth;
        main.style.setProperty(
          "--tabs-inset-start",
          `${Math.max(air, leadEnd + air - box.left)}px`,
        );
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
