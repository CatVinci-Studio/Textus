import { useLayoutEffect, useState, type RefObject } from "react";
import { flushSync } from "react-dom";
import { useMenuButton } from "../useMenuButton";
import { ChevronIcon } from "../icons";
import { Tooltip } from "../Tooltip";
import { onFontsChange } from "../text-measure";
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
 * The row's measures are read as it, the interface or its fonts change;
 * null until the row is laid out. Marks the row data-scrolled while tabs
 * lie hidden before its start (faded there, not cut off mid-name).
 */
export function useTabFit(
  bar: RefObject<HTMLElement | null>,
  tabs: readonly TabShape[],
): (TabFit & { available: number; between: number }) | null {
  const [room, setRoom] = useState<TabRoom | null>(null);
  // What the row's measures are read from: a tab, and each part one has.
  const parts = `${tabs.length > 0}${tabs.some((tab) => tab.dirty)}${tabs.some((tab) => tab.readOnly)}${tabs.some((tab) => tab.waiting)}`;
  useLayoutEffect(() => {
    const el = bar.current;
    if (!el) return;
    const read = () => {
      const next = readTabRoom(el);
      setRoom((was) => (sameRoom(was, next) ? was : next));
    };
    read();
    // Before the frame is drawn: the tabs never show a width the row has
    // already left. (A row is laid out at the width it slides to.)
    const resized = new ResizeObserver(() => flushSync(read));
    resized.observe(el);
    // The interface's size, font or theme: the row may keep its width.
    const restyled = new MutationObserver(read);
    restyled.observe(document.documentElement, { attributes: true });
    // A font arriving draws the same names at other widths.
    const fonts = onFontsChange(() => setRoom(readTabRoom(el)));
    const scrolled = () =>
      el.toggleAttribute("data-scrolled", el.scrollLeft > 1);
    scrolled();
    el.addEventListener("scroll", scrolled, { passive: true });
    return () => {
      resized.disconnect();
      restyled.disconnect();
      fonts();
      el.removeEventListener("scroll", scrolled);
    };
  }, [bar, parts]);
  return (
    room && {
      ...fitTabs(tabs, room),
      available: room.available,
      between: room.between,
    }
  );
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
