import { useLayoutEffect, type RefObject } from "react";
import { scaledPx } from "../tokens/chrome-scale";
import { frameClock } from "../frame/clock";

/** Air kept between the tabs and the window bar's own controls. */
const AIR = 8;

/** Where one tab row in the window bar's row starts and ends its tabs. */
export interface RowInsets {
  start: number;
  end: number;
  /** The first tab rises from its sheet's own edge. */
  atCorner: boolean;
}

/**
 * Each tab row sits over its sheet, the same width (layout.css).
 * Its tabs keep clear of the window bar's controls - the window's buttons
 * and the sidebar's at the bar's start, the status at its end - and of the
 * sheet's rounded corner and the tab's own curve in (`corner`). Where the
 * controls leave it room the first tab starts at the sheet's edge instead,
 * the sheet's side running straight up into it.
 */
export function rowInsets(
  row: { left: number; right: number },
  leadEnd: number,
  statusStart: number,
  air: number,
  corner: number,
): RowInsets {
  // Controls wholly before the row (the menu in the rail's column) are no
  // obstacle: the first tab can stand at the sheet's edge.
  const clear = leadEnd <= row.left ? 0 : leadEnd + air - row.left;
  const atCorner = clear <= 0;
  return {
    start: atCorner ? 0 : Math.max(clear, corner),
    end: Math.max(corner, row.right - statusStart + air),
    atCorner,
  };
}

/** A length custom property, `name`, in px as `within` lays it out. */
function lengthOf(within: HTMLElement, name: string): number {
  const probe = document.createElement("span");
  probe.style.cssText = `position:absolute;visibility:hidden;width:var(${name}, 0px)`;
  within.append(probe);
  const px = probe.getBoundingClientRect().width;
  probe.remove();
  return px;
}

/** Each mounted area's measuring, run at once. */
const settlers = new Set<() => void>();

/** Measures every tab row now, in the layout just committed: before a
 *  slide reads where things end, so the rows' insets end there with them
 *  instead of jumping a frame later. */
export function settleTabRows(): void {
  for (const settle of settlers) settle();
}

/**
 * The tabs take the window bar's row (design-language.md 5.7); each
 * island's row (IslandRow) in `pane` is measured as rowInsets says and
 * given --tabs-inset-start/-end, its tab bar data-at-corner. Its sheet is
 * told when its first tab stands at its edge, open: data-corner-joined
 * squares that corner.
 */
export function useTabRows(pane: RefObject<HTMLElement | null>) {
  useLayoutEffect(() => {
    const main = pane.current;
    if (!main) return;
    let frame = 0;
    const now = () => {
      {
        // The last of the bar's leading controls (the menu, then the
        // sidebar's toggle; the traffic lights' room in the chat window).
        const leadEnd = Math.max(
          ...[
            ...document.querySelectorAll(
              ".window-bar-sidebar-toggle, .window-menu-button, .window-bar-lead",
            ),
          ]
            .map((el) => el.getBoundingClientRect())
            .filter((box) => box.width > 0)
            .map((box) => box.right),
        );
        // What ends the bar: its status, then the window's buttons.
        const ends = [
          ...document.querySelectorAll(
            ".window-bar-status, .window-bar .window-caption",
          ),
        ]
          .filter((el) => el.firstElementChild)
          .map((el) => el.getBoundingClientRect())
          .filter((box) => box.width > 0);
        // The layout's radii (layout-tokens.css), as the page lays them out
        // (they scale with the chrome): past the corner's curve, and the
        // tab's own curve in beside it.
        // Measured beside the area, not in it: a child coming and going
        // there would set this off again.
        const shell = main.parentElement ?? document.body;
        const corner =
          lengthOf(shell, "--island-radius") + lengthOf(shell, "--tab-radius");
        const air = scaledPx(AIR);
        const barBottom =
          document
            .querySelector(".window-bar, .chat-window-header")
            ?.getBoundingClientRect().bottom ?? 0;
        const rows = [...main.querySelectorAll<HTMLElement>(".island-row")];
        const shellBox = shell.getBoundingClientRect();
        tabs.disconnect();
        for (const row of rows) {
          // Which tab is first and open decides the corner: told when one
          // opens, and when one comes or goes (a closing tab's copy, a tab
          // riding in, stands first for a moment).
          tabs.observe(row, {
            subtree: true,
            childList: true,
            attributes: true,
            attributeFilter: ["class"],
          });
          // Where the row ends up, not where a slide has it now: insets
          // for the place it is leaving would jump when it lands.
          const box = endOf(row, shellBox);
          // Only a row in the window bar's has its controls to clear: not
          // one under another island, nor under the menu bar's own row.
          const inBar = box.top < barBottom - 1;
          // The first of them over this row.
          const statusStart = Math.min(
            ...ends.filter((end) => end.left >= box.left).map((e) => e.left),
          );
          const insets = rowInsets(
            box,
            inBar ? leadEnd : -Infinity,
            inBar ? statusStart : Infinity,
            air,
            Math.max(air, corner),
          );
          row.style.setProperty("--tabs-inset-start", `${insets.start}px`);
          row.style.setProperty("--tabs-inset-end", `${insets.end}px`);
          const bar = row.querySelector(":scope > .tab-bar");
          bar?.toggleAttribute("data-at-corner", insets.atCorner);
          // Its island: the sheet of the same pane (Island).
          const id = row.dataset.paneId;
          const island = main.querySelector(
            id
              ? `[data-island][data-pane-id="${CSS.escape(id)}"]`
              : "[data-island]:not([data-pane-id])",
          );
          island?.toggleAttribute(
            "data-corner-joined",
            insets.atCorner &&
              !!bar
                ?.querySelector(
                  ":scope > .tab-pill:not(.tab-pill-ghost, .tab-pill-preview)",
                )
                ?.classList.contains("tab-pill-active"),
          );
        }
      }
    };
    const measure = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(now);
    };
    settlers.add(now);
    measure();
    const resized = new ResizeObserver(measure);
    resized.observe(main);
    const status = document.querySelector(".window-bar-status");
    if (status) resized.observe(status);
    // A split's rows come and go with its panes, and its grid with them.
    const tabs = new MutationObserver(measure);
    const rows = new MutationObserver(measure);
    rows.observe(main, {
      childList: true,
      attributes: true,
      attributeFilter: ["class"],
    });
    window.addEventListener("resize", measure);
    return () => {
      settlers.delete(now);
      cancelAnimationFrame(frame);
      resized.disconnect();
      rows.disconnect();
      tabs.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [pane]);
}

/** A row's rect at the end of any slide, in the viewport. */
function endOf(row: HTMLElement, shell: DOMRect) {
  const end = row.dataset.frame && frameClock.targetOf(row.dataset.frame);
  if (!end) return row.getBoundingClientRect();
  const left = shell.left + end.x;
  const top = shell.top + end.y;
  return { left, top, right: left + end.w, bottom: top + end.h };
}
