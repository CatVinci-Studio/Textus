import { useRef, useState } from "react";
import { Tooltip } from "../../ui/Tooltip";
import { ContextMenu, type ContextMenuEntry } from "../../ui/ContextMenu";
import { Presence } from "../../engine/motion/usePresence";
import { reorderDrag } from "../../engine/drag/pointer-drag";
import { useSettings } from "../../prefs/SettingsContext";
import type { Strings } from "../../i18n/strings";
import type { SidebarTabDef } from "./sidebar-tabs";

/** The rail's width in interface px (activity-rail.css draws the same). */
export const RAIL_WIDTH = 44;

/**
 * The column of icons at the window's left edge (design-language.md 5.7):
 * one per sidebar tab - Files, Outline, plugins' pages - in the order the
 * user dragged them. A click opens that tab; on the open one, it closes the
 * sidebar. Its right-click menu hides it or picks the icons it shows.
 */
export function ActivityRail({
  tabs,
  shownId,
  sidebarOpen,
  onSelect,
  onCloseSidebar,
  onMove,
  t,
}: {
  tabs: SidebarTabDef[];
  shownId: string;
  sidebarOpen: boolean;
  onSelect: (id: string) => void;
  onCloseSidebar: () => void;
  /** A tab dragged into another's place. */
  onMove: (id: string, target: string) => void;
  t: Strings;
}) {
  const { settings, setSettings } = useSettings();
  const ref = useRef<HTMLElement>(null);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const hidden = new Set(settings.activityRailHidden);
  // The tab shown keeps its icon, hidden or not.
  const shownTabs = tabs.filter(
    (tab) => !hidden.has(tab.id) || tab.id === shownId,
  );
  const menuItems: ContextMenuEntry[] = [
    {
      label: t.activityRailHide,
      onSelect: () => setSettings({ activityRail: false }),
    },
    "separator",
    ...tabs.map((tab) => ({
      label: tab.label(t),
      checked: !hidden.has(tab.id),
      onSelect: () =>
        setSettings({
          activityRailHidden: hidden.has(tab.id)
            ? settings.activityRailHidden.filter((id) => id !== tab.id)
            : [...settings.activityRailHidden, tab.id],
        }),
    })),
  ];
  return (
    <nav
      className="activity-rail"
      aria-label={t.activityRail}
      ref={ref}
      onContextMenu={(e) => {
        e.preventDefault();
        setMenu({ x: e.clientX, y: e.clientY });
      }}
    >
      {shownTabs.map(({ id, label, Icon }) => {
        const on = sidebarOpen && shownId === id;
        return (
          <Tooltip key={id} text={label(t)}>
            <button
              type="button"
              className="activity-rail-item"
              aria-label={label(t)}
              aria-pressed={on}
              data-reorder-id={id}
              onClick={() => (on ? onCloseSidebar() : onSelect(id))}
              // Dragged along the column, the others make way.
              onPointerDown={(e) => {
                const rail = ref.current;
                if (!rail || e.pointerType === "touch") return;
                reorderDrag(e, {
                  container: rail,
                  id,
                  axis: "y",
                  onDrop: (dragged, index) =>
                    onMove(dragged, shownTabs[index].id),
                });
              }}
            >
              <Icon />
            </button>
          </Tooltip>
        );
      })}
      <Presence show={menu !== null} exitMs={120}>
        {menu && (
          <ContextMenu
            x={menu.x}
            y={menu.y}
            items={menuItems}
            onClose={() => setMenu(null)}
          />
        )}
      </Presence>
    </nav>
  );
}
