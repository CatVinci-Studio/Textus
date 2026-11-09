import { scaledPx } from "../ui/chrome-scale";
import { useLayoutEffect, useRef, useState } from "react";
import { Tooltip } from "../ui/Tooltip";
import { ContextMenu } from "../ui/ContextMenu";
import { Presence } from "../ui/usePresence";
import { MoreIcon } from "../ui/icons";
import { reorderDrag } from "../ui/pointer-drag";
import type { Strings } from "../i18n/strings";
import type { SidebarTabDef } from "./sidebar-tabs";

/** The narrowest a tab's button gets before the rest go under "More". */
export const TAB_MIN_PX = 30;

/** The tabs that fit in `fit` buttons, and those that go under "More" (one
 *  button of its own). The tab shown always keeps a button. */
export function fitTabs<T extends { id: string }>(
  tabs: readonly T[],
  shownId: string,
  fit: number,
): { inline: T[]; more: T[] } {
  if (tabs.length <= fit) return { inline: [...tabs], more: [] };
  const room = Math.max(1, fit - 1);
  const inline = tabs.slice(0, room);
  const shown = tabs.find((tab) => tab.id === shownId);
  if (shown && !inline.includes(shown)) inline[room - 1] = shown;
  return { inline, more: tabs.filter((tab) => !inline.includes(tab)) };
}

/** The sidebar's tab buttons, as many as its width holds. */
export function SidebarTabBar({
  tabs,
  shownId,
  onSelect,
  onMove,
  t,
}: {
  tabs: SidebarTabDef[];
  shownId: string;
  onSelect: (id: string) => void;
  /** A tab dragged into another's place. */
  onMove: (id: string, target: string) => void;
  t: Strings;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [fit, setFit] = useState(Infinity);
  const [menu, setMenu] = useState<{
    x: number;
    y: number;
    keyboard: boolean;
  } | null>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const measure = () =>
      setFit(
        Math.max(1, Math.floor(el.clientWidth / scaledPx(TAB_MIN_PX))) ||
          Infinity,
      );
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  const { inline, more } = fitTabs(tabs, shownId, fit);
  return (
    <div className="sidebar-tabs" ref={ref}>
      {inline.map(({ id, label, Icon }) => (
        <Tooltip key={id} text={label(t)}>
          <button
            className={`sidebar-tab ${shownId === id ? "sidebar-tab-active" : ""}`}
            onClick={() => onSelect(id)}
            aria-label={label(t)}
            data-reorder-id={id}
            // Dragged along the bar, the others make way; let go, it stays.
            onPointerDown={(e) => {
              const bar = ref.current;
              if (!bar || e.pointerType === "touch") return;
              reorderDrag(e, {
                container: bar,
                id,
                onDrop: (dragged, index) => onMove(dragged, inline[index].id),
              });
            }}
          >
            <Icon />
          </button>
        </Tooltip>
      ))}
      {more.length > 0 && (
        <Tooltip text={t.toolbarMore}>
          <button
            className="sidebar-tab"
            aria-label={t.toolbarMore}
            aria-haspopup="menu"
            onClick={(e) => {
              const box = e.currentTarget.getBoundingClientRect();
              // detail 0: Enter or Space, so the menu takes the focus.
              setMenu({
                x: box.left,
                y: box.bottom + 4,
                keyboard: e.detail === 0,
              });
            }}
          >
            <MoreIcon />
          </button>
        </Tooltip>
      )}
      <Presence show={menu !== null} exitMs={120}>
        {menu && (
          <ContextMenu
            x={menu.x}
            y={menu.y}
            keyboard={menu.keyboard}
            items={more.map((tab) => ({
              label: tab.label(t),
              onSelect: () => onSelect(tab.id),
            }))}
            onClose={() => setMenu(null)}
          />
        )}
      </Presence>
    </div>
  );
}
