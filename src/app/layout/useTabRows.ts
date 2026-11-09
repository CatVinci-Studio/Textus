import { useLayoutEffect, type RefObject } from "react";
import { scaledPx } from "../../ui/chrome-scale";

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
  const clear = leadEnd + air - row.left;
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

/**
 * The tabs take the window bar's row (design-language.md 5.7); each of the
 * pane's tab rows - one, or a split's panes' - is measured as rowInsets
 * says and given --tabs-inset-start/-end and data-at-corner. Its island
 * (IslandFrame) is told when its first tab stands at its edge, open:
 * data-corner-joined squares that corner.
 */
export function useTabRows(pane: RefObject<HTMLElement | null>) {
  useLayoutEffect(() => {
    const main = pane.current;
    if (!main) return;
    let frame = 0;
    const measure = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
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
        // What ends the bar: its status (beside the AI island while that
        // is open), then the window's buttons.
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
        const rows = [
          ...main.querySelectorAll<HTMLElement>(":scope > .tab-bar"),
          ...document.querySelectorAll<HTMLElement>(
            ".agent-tabs-row > .tab-bar",
          ),
        ];
        tabs.disconnect();
        for (const row of rows) {
          // Which tab is open decides the corner: told when it changes.
          tabs.observe(row, {
            subtree: true,
            attributes: true,
            attributeFilter: ["class"],
          });
          // A split's grid resized moves its rows; the area's own style
          // changes too often to watch.
          resized.observe(row);
          // The AI island's row is its holder's, its buttons at the end
          // (AgentTabs); its island the one under it.
          const ai = row.parentElement?.classList.contains("agent-tabs-row");
          const holder = ai ? row.parentElement! : row;
          // A lower pane's row has no bar controls to clear.
          const inBar = !row.classList.contains("tab-bar-inner");
          const box = holder.getBoundingClientRect();
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
          holder.style.setProperty("--tabs-inset-start", `${insets.start}px`);
          holder.style.setProperty("--tabs-inset-end", `${insets.end}px`);
          row.toggleAttribute("data-at-corner", insets.atCorner);
          // Its island: the pane's frame (IslandFrame), one alone or each
          // of a split's by its pane.
          const id = row.dataset.paneId;
          const island = ai
            ? holder
                .closest(".agent-panel, .chat-window")
                ?.querySelector("[data-island]")
            : main.querySelector(
                id
                  ? `:scope > .island-frame[data-pane-id="${CSS.escape(id)}"]`
                  : ":scope > .island-frame:not([data-pane-id])",
              );
          island?.toggleAttribute(
            "data-corner-joined",
            insets.atCorner &&
              !!row.querySelector(":scope > .tab-pill-active:first-child"),
          );
        }
      });
    };
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
    // The pane slides with the sidebar and the AI panel.
    document.addEventListener("transitionend", measure);
    return () => {
      cancelAnimationFrame(frame);
      resized.disconnect();
      rows.disconnect();
      tabs.disconnect();
      window.removeEventListener("resize", measure);
      document.removeEventListener("transitionend", measure);
    };
  }, [pane]);
}
