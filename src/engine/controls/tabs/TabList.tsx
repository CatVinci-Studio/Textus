import { onAppearance } from "../../tokens/appearance";
import { useLayoutEffect, useRef, useState, type RefObject } from "react";
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
  type PillMeasures,
  type TabRoom,
  type TabShape,
} from "./tab-room";
import type { TabFit } from "./tab-widths";

/** A tab's measures by its row's kind and the parts its tabs have. */
const PILLS = new Map<string, PillMeasures>();

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
  const shapes = useRef(tabs);
  shapes.current = tabs;
  // What the row's measures are read from: a tab, and each part one has.
  const parts = `${tabs.length > 0}${tabs.some((tab) => tab.dirty)}${tabs.some((tab) => tab.readOnly)}${tabs.some((tab) => tab.waiting)}`;
  useLayoutEffect(() => {
    const el = bar.current;
    if (!el) return;
    // A tab's measures: every row's stylesheet is the same, so one row's
    // serve all with the same parts, until the look or a font changes.
    const read = (fresh = false) => {
      if (fresh) PILLS.clear();
      const key = `${el.className}|${parts}`;
      const next = readTabRoom(el, PILLS.get(key));
      if (next) PILLS.set(key, next.pill);
      setRoom((was) =>
        sameRoom(was, next) || sameFit(was, next) ? was : next,
      );
    };
    read();
    // Before the frame is drawn: the tabs never show a width the row has
    // already left. (A row is laid out at the width it slides to.)
    const resized = new ResizeObserver(() => flushSync(() => read()));
    resized.observe(el);
    // The interface's size, font or theme: the row may keep its width.
    const restyled = onAppearance(() => read(true));
    // A font arriving draws the same names at other widths.
    const fonts = onFontsChange(() => read(true));
    const scrolled = () =>
      el.toggleAttribute("data-scrolled", el.scrollLeft > 1);
    // Next frame: read now, it would lay the new row out first.
    const first = requestAnimationFrame(scrolled);
    el.addEventListener("scroll", scrolled, { passive: true });
    return () => {
      cancelAnimationFrame(first);
      resized.disconnect();
      restyled();
      fonts();
      el.removeEventListener("scroll", scrolled);
    };
  }, [bar, parts]);
  /** A row resized (a divider dragged) whose tabs all fit as before at the
   *  same widths: nothing to draw again. */
  function sameFit(was: TabRoom | null, next: TabRoom | null): boolean {
    if (!was || !next || was.between !== next.between) return false;
    const a = fitTabs(shapes.current, was);
    const b = fitTabs(shapes.current, next);
    return (
      !a.overflow && !b.overflow && JSON.stringify(a) === JSON.stringify(b)
    );
  }
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
