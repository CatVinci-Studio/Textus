import { useLayoutEffect, useState, type RefObject } from "react";
import { flushSync } from "react-dom";
import { useMenuButton } from "../useMenuButton";
import { ChevronIcon } from "../icons";
import { Tooltip } from "../Tooltip";
import { scrollBehavior } from "../../motion/motion";
import { frameClock } from "../../frame/clock";
import type { TabInfo } from "./TabPill";
import {
  fitTabs,
  readTabRoom,
  sameRoom,
  type TabRoom,
  type TabShape,
} from "./tab-room";
import type { TabFit } from "./tab-widths";

/**
 * Many tabs: each as wide as its name needs, the widest giving way first
 * when the row can't hold them, and once even the narrowest don't fit, the
 * row scrolls and a button at its end lists every tab (tab-widths.ts).
 * Reads the row's measures as it and the interface change and gives the
 * tabs' fit to them; null until the row is laid out. Marks the row
 * data-scrolled while tabs lie hidden before its start (faded there, not
 * cut off mid-name).
 */
export function useTabFit(
  bar: RefObject<HTMLElement | null>,
  tabs: readonly TabShape[],
  /** Something else stands in the row (a tab riding in). */
  crowded: boolean,
): TabFit | null {
  const [room, setRoom] = useState<TabRoom | null>(null);
  // What the row's measures are read from: a tab, and each part one has.
  const parts = `${tabs.length > 0}${tabs.some((tab) => tab.dirty)}${tabs.some((tab) => tab.readOnly)}${crowded}`;
  useLayoutEffect(() => {
    const el = bar.current;
    if (!el) return;
    const read = () => {
      const next = readTabRoom(el);
      setRoom((was) => (sameRoom(was, next) ? was : next));
    };
    read();
    // Before the frame is drawn: the tabs never show a width the row has
    // already left.
    const resized = new ResizeObserver(() => {
      // Mid-slide its island's row is between widths: the tabs keep the fit
      // for where it lands, measured again once it is there.
      const row = el.closest<HTMLElement>("[data-frame]");
      const end = row?.dataset.frame && frameClock.targetOf(row.dataset.frame);
      if (end && Math.abs(end.w - row.offsetWidth) > 0.5) return;
      flushSync(read);
      revealActive(el, false);
    });
    resized.observe(el);
    // The interface's size, font or theme: the row may keep its width.
    const restyled = new MutationObserver(read);
    restyled.observe(document.documentElement, { attributes: true });
    const scrolled = () =>
      el.toggleAttribute("data-scrolled", el.scrollLeft > 1);
    scrolled();
    el.addEventListener("scroll", scrolled, { passive: true });
    return () => {
      resized.disconnect();
      restyled.disconnect();
      el.removeEventListener("scroll", scrolled);
    };
  }, [bar, parts]);
  return room && fitTabs(tabs, room);
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
