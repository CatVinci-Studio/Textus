import { listMove } from "../list-keys";
import { useRef, useState, type CSSProperties } from "react";
import { Tooltip } from "../Tooltip";
import { ContextMenu, type ContextMenuEntry } from "../ContextMenu";
import { Presence } from "../../motion/usePresence";
import { TabPill, type TabInfo } from "./TabPill";
import { TabListButton, useTabFit } from "./TabList";
import { INCOMING, useTabStrip } from "./useTabStrip";
import { stripSlots } from "./tab-strip";
import { useRevealTab } from "./useRevealTab";
import { isMobileApp } from "../../../platform/capabilities";
import { PlusIcon } from "../icons";

interface TabBarProps {
  tabs: TabInfo[];
  activeTabId: string;
  onActivate: (id: string) => void;
  onClose: (id: string) => void;
  onAdd: () => void;
  /** Fired once when a pill is pulled down out of the bar; the rest of the
   *  drag is the caller's. Omitted, a pull down stays a reorder. */
  onPullOut?: (id: string, title: string, e: PointerEvent) => void;
  // Move the tab so it sits at `index` among the OTHER tabs.
  onReorder: (id: string, index: number) => void;
  /** A preview tab kept (double-clicked). */
  onKeep?: (id: string) => void;
  // A tab dragged in from another window, shown as a pill riding the
  // cursor; on release it becomes the real tab in that slot.
  previewTab: { title: string; dirty: boolean; x: number } | null;
  /** A tab's right-click menu (Open to the Side, Close). */
  menuFor?: (id: string) => ContextMenuEntry[];
  /** What the icon-only buttons' tooltips and a screen reader say. */
  labels: {
    tabs: string;
    close: string;
    add: string;
    unsaved: string;
    /** The list of every tab, once they overflow the row. */
    all: string;
    /** A tab in reading mode's padlock. */
    readOnly?: string;
    /** A pinned tab's pin. */
    pinned?: string;
    /** A tab's count of Textus AI's revisions waiting in it. */
    waiting?: (n: number) => string;
  };
  /** A tab's padlock clicked: its reading mode off. */
  onUnlock?: (id: string) => void;
  /** Where it sits in a split's grid. */
  style?: CSSProperties;
  /** The split pane it is the bar of: a pulled tab is let go onto it. */
  paneId?: string;
  /** A pane's bar below another pane: no room kept for the window bar. */
  inner?: boolean;
}

export function TabBar({
  tabs,
  activeTabId,
  onActivate,
  onClose,
  onAdd,
  onPullOut,
  onReorder,
  onKeep,
  previewTab,
  menuFor,
  labels,
  onUnlock,
  style,
  paneId,
  inner,
}: TabBarProps) {
  const barRef = useRef<HTMLDivElement>(null);
  const stripEl = useRef<HTMLDivElement>(null);
  const [menu, setMenu] = useState<{
    x: number;
    y: number;
    items: ContextMenuEntry[];
  } | null>(null);

  const ids = tabs.map((tab) => tab.id);
  const shapes = tabs.map((tab) => ({
    ...tab,
    open: tab.id === activeTabId,
  }));
  const fit = useTabFit(
    barRef,
    previewTab
      ? [...shapes, { title: previewTab.title, dirty: previewTab.dirty }]
      : shapes,
    isMobileApp,
  );
  // One tab too long for its row is cut short, not listed: a list of one
  // tells nothing.
  const overflow = !!fit?.overflow && tabs.length > 1;
  const strip = useTabStrip({
    strip: stripEl,
    pane: paneId ?? null,
    ids,
    widths: fit?.widths ?? null,
    gap: fit?.between ?? 0,
    incomingX: previewTab?.x ?? null,
  });

  // The open tab in view as it changes, and as the row narrows.
  const { x: slotX, w: slotW } = strip.slotOf(activeTabId) ?? {};
  const shownLength = fit && fit.available - (overflow ? fit.list : 0);
  // What the reveal reads when the row resizes: the tab's place and the
  // row's room as last laid out, not as they were when it began watching.
  const slots = isMobileApp && fit ? stripSlots(fit.widths, fit.between) : [];
  const last = slots[slots.length - 1];
  useRevealTab(barRef, stripEl, activeTabId, {
    slotX,
    slotW,
    shownLength,
    edges: slots.length ? slots.map((slot) => slot.x) : null,
    end: last ? last.x + last.w : 0,
  });

  const pillOf = (id: string) =>
    stripEl.current?.querySelector<HTMLElement>(
      `[data-tab="${CSS.escape(id)}"]`,
    );

  // Tab-list keys: arrows/Home/End move, Enter/Space shows, Delete closes.
  // Only the front tab is in the tab order.
  function onKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    const id = (e.target as HTMLElement).dataset.tab;
    const at = id === undefined ? -1 : ids.indexOf(id);
    if (at === -1 || e.altKey || e.ctrlKey || e.metaKey) return;
    const moved = listMove(e.key, at, ids.length, true, "row");
    const next = moved === null ? undefined : ids[moved];
    if (next !== undefined) pillOf(next)?.focus();
    else if (e.key === "Enter" || e.key === " ") onActivate(id!);
    else if (e.key === "Delete") {
      const near = ids[at + 1] ?? ids[at - 1];
      if (near) pillOf(near)?.focus();
      onClose(id!);
    } else return;
    e.preventDefault();
  }

  return (
    <div
      className={inner ? "tab-bar tab-bar-inner" : "tab-bar"}
      style={style}
      // In the window bar's row, its empty stretch still moves the window.
      data-tauri-drag-region={inner ? undefined : true}
      data-pane-id={paneId}
      data-overflow={overflow || undefined}
      data-touch={isMobileApp || undefined}
      ref={barRef}
      role="tablist"
      aria-label={labels.tabs}
      onKeyDown={onKeyDown}
    >
      <div className="tab-strip" ref={strip.stripRef}>
        {tabs.map((tab, i) => (
          <TabPill
            key={tab.id}
            pane={paneId ?? null}
            place={strip.attach(tab.id)}
            at={[
              i === 0 && "first",
              i === tabs.length - 1 && "last",
              tabs[i + 1]?.id === activeTabId && "before-open",
            ]
              .filter(Boolean)
              .join(" ")}
            tab={tab}
            width={fit?.widths[i]}
            cut={fit?.cut[i]}
            isActive={tab.id === activeTabId}
            labels={labels}
            onUnlock={onUnlock}
            onActivate={onActivate}
            onClose={onClose}
            onPullOut={
              onPullOut &&
              ((id, title, e) => {
                strip.dragEnd(id, 0);
                onPullOut(id, title, e);
              })
            }
            onDrag={strip.dragTo}
            onDrop={(id, dx) => onReorder(id, strip.dragEnd(id, dx))}
            onKeep={onKeep}
            onMenu={
              menuFor && ((x, y) => setMenu({ x, y, items: menuFor(tab.id) }))
            }
          />
        ))}
        {previewTab && (
          <div
            className="tab-pill tab-pill-active tab-pill-preview"
            ref={strip.attach(INCOMING)}
          >
            {previewTab.dirty && <span className="tab-pill-dirty-dot" />}
            <span className="tab-pill-title">{previewTab.title}</span>
          </div>
        )}
      </div>
      <Presence show={menu !== null}>
        {menu && (
          <ContextMenu
            x={menu.x}
            y={menu.y}
            items={menu.items}
            onClose={() => setMenu(null)}
          />
        )}
      </Presence>
      {/* A tab list holds only tabs, so this stays out of its tree. */}
      <Tooltip text={labels.add} description={null}>
        <button
          className="tab-bar-add"
          tabIndex={-1}
          aria-hidden="true"
          onClick={(e) => {
            // Not left holding the focus a tap gave it: Enter would add more.
            e.currentTarget.blur();
            onAdd();
          }}
        >
          <PlusIcon />
        </button>
      </Tooltip>
      {overflow && (
        <TabListButton
          tabs={tabs}
          activeTabId={activeTabId}
          onActivate={onActivate}
          label={labels.all}
          activeMenu={menuFor && (() => menuFor(activeTabId))}
        />
      )}
    </div>
  );
}
