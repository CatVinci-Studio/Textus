import { useScrollFade } from "../../engine/controls/scroll-fade";
import { useRef, useState } from "react";
import { Tooltip } from "../../engine/controls/Tooltip";
import {
  ContextMenu,
  type ContextMenuEntry,
} from "../../engine/controls/ContextMenu";
import { Presence } from "../../engine/motion/usePresence";
import { RAIL_DIVIDER, railDrag } from "./rail-drag";
import { useSettings } from "../../prefs/SettingsContext";
import { SettingsIcon } from "../../engine/controls/icons";
import { RailUpdate } from "./RailUpdate";
import { emitToThisWindow } from "../../platform/menu-events";
import type { Strings } from "../../i18n/strings";
import { isOwnTab, railOrder, type SidebarTabDef } from "./sidebar-tabs";

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
  onReorder,
  t,
}: {
  tabs: SidebarTabDef[];
  shownId: string;
  sidebarOpen: boolean;
  onSelect: (id: string) => void;
  onCloseSidebar: () => void;
  /** The rail's icons dragged into a new order. */
  /** Its order or pinned set changed (kept in the settings). */
  onReorder: () => void;
  t: Strings;
}) {
  const { settings, setSettings } = useSettings();
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const hidden = new Set(settings.activityRailHidden);
  // The tab shown keeps its icon, hidden or not.
  const shownTabs = tabs.filter(
    (tab) => !tab.railFoot && (!hidden.has(tab.id) || tab.id === shownId),
  );
  const settingsOn = sidebarOpen && shownId === "settings";
  // Textus's own and the plugins' the user pinned among them, in the tabs'
  // order; the rest under the line, scrolling when they don't all fit.
  const pinned = settings.activityRailPinned;
  const above = (id: string) => isOwnTab(id) || pinned.includes(id);
  const top = shownTabs.filter((tab) => above(tab.id));
  const rest = shownTabs.filter((tab) => !above(tab.id));
  // An icon let go somewhere in the column: above the line it is pinned
  // there, under it among the plugins; the order is the tabs' order.
  const reorder = (order: string[]) => {
    const line = order.indexOf(RAIL_DIVIDER);
    const above = line < 0 ? order : order.slice(0, line);
    const ids = order.filter((x) => x !== RAIL_DIVIDER);
    const onRail = new Set(ids);
    setSettings({
      activityRailPinned: [
        ...above.filter((x) => !isOwnTab(x)),
        ...pinned.filter((x) => !onRail.has(x)),
      ],
      activityRailOrder: railOrder(ids),
    });
    onReorder();
  };
  const drag = (e: React.PointerEvent<HTMLElement>, id: string) => {
    const rail = e.currentTarget.closest<HTMLElement>(".activity-rail");
    if (!rail || e.pointerType === "touch") return;
    railDrag(e.nativeEvent, {
      rail,
      id,
      staysAbove: isOwnTab(id),
      onDrop: reorder,
    });
  };
  const menuItems: ContextMenuEntry[] = [
    // Turned off, it still shows with the sidebar: then it offers to stay.
    settings.activityRail
      ? {
          label: t.activityRailHide,
          onSelect: () => setSettings({ activityRail: false }),
        }
      : {
          label: t.activityRailShow,
          onSelect: () => setSettings({ activityRail: true }),
        },
    "separator",
    ...tabs
      .filter((tab) => !tab.railFoot)
      .map((tab) => ({
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
      onContextMenu={(e) => {
        e.preventDefault();
        setMenu({ x: e.clientX, y: e.clientY });
      }}
    >
      <RailGroup
        tabs={top}
        on={(id) => sidebarOpen && shownId === id}
        {...{ drag, onSelect, onCloseSidebar, t }}
      />
      {rest.length > 0 && (
        <hr className="activity-rail-divider" data-rail-id={RAIL_DIVIDER} />
      )}
      <RailGroup
        tabs={rest}
        scrolls
        on={(id) => sidebarOpen && shownId === id}
        {...{ drag, onSelect, onCloseSidebar, t }}
      />
      {/* A newer release, while there is one, over Settings. */}
      <RailUpdate t={t} />
      {/* Settings at the column's foot, out of the tabs' order. */}
      <Tooltip text={t.settingsTitle} side="right">
        <button
          type="button"
          className="activity-rail-item activity-rail-settings"
          aria-label={t.settingsTitle}
          aria-pressed={settingsOn}
          // Like every rail icon: opens the sidebar on Settings' pages, or
          // closes it (the Settings tab comes to the front as it opens).
          onClick={() =>
            settingsOn ? onCloseSidebar() : emitToThisWindow("menu-settings")
          }
        >
          <SettingsIcon />
        </button>
      </Tooltip>
      <Presence show={menu !== null}>
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

/** One group of the rail's icons - the top's, or the plugins' under the
 *  line; dragging one moves it along the whole rail (rail-drag.ts).
 *  `scrolls`: the middle that scrolls. */
function RailGroup({
  tabs,
  on,
  scrolls = false,
  drag,
  onSelect,
  onCloseSidebar,
  t,
}: {
  tabs: SidebarTabDef[];
  on: (id: string) => boolean;
  scrolls?: boolean;
  drag: (e: React.PointerEvent<HTMLElement>, id: string) => void;
  onSelect: (id: string) => void;
  onCloseSidebar: () => void;
  t: Strings;
}) {
  const ref = useRef<HTMLDivElement>(null);
  // More plugins above or below than show: that end fades.
  useScrollFade(ref, "y", !!scrolls && tabs.length > 0);
  if (!tabs.length) return null;
  return (
    <div
      className={`activity-rail-group${scrolls ? " activity-rail-scroll tx-scroll-fade" : ""}`}
      ref={ref}
    >
      {tabs.map(({ id, label, Icon }) => (
        <Tooltip key={id} text={label(t)} side="right">
          <button
            type="button"
            className="activity-rail-item"
            aria-label={label(t)}
            aria-pressed={on(id)}
            data-rail-id={id}
            onClick={() => (on(id) ? onCloseSidebar() : onSelect(id))}
            onPointerDown={(e) => drag(e, id)}
          >
            <Icon />
          </button>
        </Tooltip>
      ))}
    </div>
  );
}
