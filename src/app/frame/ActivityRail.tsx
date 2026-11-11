import { useScrollFade } from "../../engine/controls/scroll-fade";
import { useRef, useState } from "react";
import { Tooltip } from "../../engine/controls/Tooltip";
import {
  ContextMenu,
  type ContextMenuEntry,
} from "../../engine/controls/ContextMenu";
import { Presence } from "../../engine/motion/usePresence";
import { reorderDrag } from "../../engine/drag/row";
import { liftBeyondGroup } from "./rail-lift";
import { useSettings } from "../../prefs/SettingsContext";
import { SettingsIcon } from "../../engine/controls/icons";
import { emitToThisWindow } from "../../platform/menu-events";
import type { Strings } from "../../i18n/strings";
import { isOwnTab, type SidebarTabDef } from "./sidebar-tabs";

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
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const hidden = new Set(settings.activityRailHidden);
  // The tab shown keeps its icon, hidden or not.
  const shownTabs = tabs.filter(
    (tab) => !tab.railFoot && (!hidden.has(tab.id) || tab.id === shownId),
  );
  const settingsOn = sidebarOpen && shownId === "settings";
  // Textus's own, then the plugins' the user pinned beside them; the rest
  // under the line, scrolling when they don't all fit.
  const pinned = settings.activityRailPinned;
  const top = [
    ...shownTabs.filter((tab) => isOwnTab(tab.id)),
    ...pinned.flatMap((id) => shownTabs.filter((tab) => tab.id === id)),
  ];
  const rest = shownTabs.filter(
    (tab) => !isOwnTab(tab.id) && !pinned.includes(tab.id),
  );
  const pin = (id: string, on: boolean) =>
    setSettings({
      activityRailPinned: on
        ? [...pinned.filter((p) => p !== id), id]
        : pinned.filter((p) => p !== id),
    });
  const menuItems: ContextMenuEntry[] = [
    {
      label: t.activityRailHide,
      onSelect: () => setSettings({ activityRail: false }),
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
        // A pinned plugin's icon let go below the line goes back under it.
        canLeave={(id) => pinned.includes(id)}
        onDropBeyond={(id, side) =>
          side === "after" && pinned.includes(id) && pin(id, false)
        }
        {...{ onSelect, onCloseSidebar, onMove, t }}
      />
      {rest.length > 0 && <hr className="activity-rail-divider" />}
      <RailGroup
        tabs={rest}
        scrolls
        on={(id) => sidebarOpen && shownId === id}
        // Let go above the line: pinned among Textus's own.
        canLeave={() => true}
        onDropBeyond={(id, side) => side === "before" && pin(id, true)}
        {...{ onSelect, onCloseSidebar, onMove, t }}
      />
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
            settingsOn
              ? onCloseSidebar()
              : emitToThisWindow("menu-open-settings")
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
 *  line: dragged along it, the others make way; let go past its ends,
 *  `onDropBeyond` hears which way. `scrolls`: the middle that scrolls. */
function RailGroup({
  tabs,
  on,
  scrolls = false,
  canLeave,
  onDropBeyond,
  onSelect,
  onCloseSidebar,
  onMove,
  t,
}: {
  tabs: SidebarTabDef[];
  on: (id: string) => boolean;
  scrolls?: boolean;
  /** Whether `id` let go in the other group changes anything. */
  canLeave: (id: string) => boolean;
  onDropBeyond: (id: string, side: "before" | "after") => void;
  onSelect: (id: string) => void;
  onCloseSidebar: () => void;
  onMove: (id: string, target: string) => void;
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
            data-reorder-id={id}
            onClick={() => (on(id) ? onCloseSidebar() : onSelect(id))}
            onPointerDown={(e) => {
              const group = ref.current;
              if (!group || e.pointerType === "touch") return;
              const startY = e.clientY;
              if (canLeave(id))
                liftBeyondGroup(
                  e.nativeEvent,
                  e.currentTarget,
                  group,
                  [
                    ...(group.parentElement?.querySelectorAll<HTMLElement>(
                      ".activity-rail-group",
                    ) ?? []),
                  ].find((g) => g !== group) ?? null,
                );
              window.addEventListener(
                "pointerup",
                (up) => {
                  if (Math.abs(up.clientY - startY) < 8) return;
                  const box = group.getBoundingClientRect();
                  if (up.clientY < box.top) onDropBeyond(id, "before");
                  else if (up.clientY > box.bottom) onDropBeyond(id, "after");
                },
                { once: true },
              );
              reorderDrag(e, {
                container: group,
                id,
                axis: "y",
                onDrop: (dragged, index) => onMove(dragged, tabs[index].id),
              });
            }}
          >
            <Icon />
          </button>
        </Tooltip>
      ))}
    </div>
  );
}
