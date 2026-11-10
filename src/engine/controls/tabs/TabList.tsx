import { useLayoutEffect, useState, type RefObject } from "react";
import { useMenuButton } from "../useMenuButton";
import { ChevronIcon } from "../icons";
import { Tooltip } from "../Tooltip";
import { scrollBehavior } from "../../motion/motion";
import type { TabInfo } from "./TabPill";

/**
 * Many tabs, as Chrome has them: the pills shrink together, the narrow ones
 * give up their × (the open one keeps it), and once even that leaves them
 * past the row, a button at its end lists every tab. Watches the row as it
 * and its tabs change; marks it data-narrow and data-overflow, and
 * data-scrolled while tabs lie hidden before its start (faded there, not
 * cut off mid-name).
 */
export function useTabOverflow(
  bar: RefObject<HTMLElement | null>,
  count: number,
): boolean {
  const [overflow, setOverflow] = useState(false);
  useLayoutEffect(() => {
    const el = bar.current;
    if (!el) return;
    const resized = new ResizeObserver(() => fit());
    const fit = () => {
      // A title longer than its tab fades out at its end (TabBar.css);
      // each title watched, as a tab still growing in was cut a moment and
      // kept the fade after.
      for (const title of el.querySelectorAll<HTMLElement>(".tab-pill-title")) {
        title.toggleAttribute(
          "data-cut",
          title.scrollWidth > title.clientWidth + 1,
        );
        resized.observe(title);
      }
      const over = el.scrollWidth > el.clientWidth + 1;
      el.toggleAttribute("data-overflow", over);
      setOverflow(over);
      revealActive(el, false);
    };
    const scrolled = () =>
      el.toggleAttribute("data-scrolled", el.scrollLeft > 1);
    fit();
    scrolled();
    resized.observe(el);
    // A tab renamed at its widest changes no size: its words are watched.
    const renamed = new MutationObserver(fit);
    renamed.observe(el, {
      subtree: true,
      characterData: true,
      childList: true,
    });
    el.addEventListener("scroll", scrolled, { passive: true });
    return () => {
      resized.disconnect();
      renamed.disconnect();
      el.removeEventListener("scroll", scrolled);
    };
  }, [bar, count]);
  return overflow;
}

/** The row's list of every tab, the open one ticked; picking one shows it. */
export function TabListButton({
  tabs,
  activeTabId,
  onActivate,
  label,
}: {
  tabs: TabInfo[];
  activeTabId: string;
  onActivate: (id: string) => void;
  label: string;
}) {
  const list = useMenuButton(
    () =>
      tabs.map((tab) => ({
        label: tab.title,
        checked: tab.id === activeTabId,
        onSelect: () => onActivate(tab.id),
      })),
    { alignEnd: true },
  );
  return (
    <>
      <Tooltip text={label} description={null}>
        <button
          type="button"
          className="tab-bar-list"
          aria-label={label}
          {...list.button}
        >
          <ChevronIcon />
        </button>
      </Tooltip>
      {list.menu}
    </>
  );
}

/**
 * Scrolls the row alone (never the page) to bring its open tab into the
 * part that shows: inside its ends, before the + and the list held at its
 * end. A phone shows two or three pills, a full row only some.
 */
export function revealActive(bar: HTMLElement, smooth: boolean) {
  const pill = bar.querySelector<HTMLElement>(".tab-pill-active");
  if (!pill) return;
  const box = bar.getBoundingClientRect();
  const style = getComputedStyle(bar);
  const held = bar.hasAttribute("data-overflow")
    ? [...bar.querySelectorAll(".tab-bar-add, .tab-bar-list")].reduce(
        (sum, el) => sum + el.getBoundingClientRect().width,
        0,
      )
    : 0;
  const left = box.left + parseFloat(style.paddingLeft);
  const right = box.right - parseFloat(style.paddingRight) - held;
  const at = pill.getBoundingClientRect();
  const margin = 12;
  const behavior = smooth ? scrollBehavior() : "auto";
  if (at.left < left + margin)
    bar.scrollBy({ left: at.left - left - margin, behavior });
  else if (at.right > right - margin)
    bar.scrollBy({ left: at.right - right + margin, behavior });
}
