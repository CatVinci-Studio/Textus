import { useEffect, useRef, useState, type CSSProperties } from "react";
import { Tooltip } from "../Tooltip";
import { ContextMenu, type ContextMenuEntry } from "../ContextMenu";
import { Presence } from "../../motion/usePresence";
import { scrollBehavior } from "../../motion/motion";
import { scaledPx } from "../../tokens/chrome-scale";
import { TabPill, type TabInfo } from "./TabPill";
import { TabListButton, useTabFit } from "./TabList";
import { INCOMING, useTabStrip } from "./useTabStrip";
import type { Slot } from "./tab-strip";

interface TabBarProps {
  tabs: TabInfo[];
  activeTabId: string;
  onActivate: (id: string) => void;
  onClose: (id: string) => void;
  onAdd: () => void;
  /** Fired once when a pill is pulled down out of the bar; the rest of the
   *  drag is the caller's. Omitted, a pull down stays a reorder. */
  onPullOut?: (id: string, title: string) => void;
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
  const fit = useTabFit(
    barRef,
    previewTab
      ? [...tabs, { title: previewTab.title, dirty: previewTab.dirty }]
      : tabs,
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
  const shownLength = fit && fit.available - (overflow ? scaledPx(24) : 0);
  const smooth = useRef<string | null>(null);
  useEffect(() => {
    const bar = barRef.current;
    if (!bar || slotX === undefined || slotW === undefined) return;
    if (shownLength === null) return;
    const slot = { x: slotX, w: slotW };
    reveal(bar, slot, shownLength, smooth.current !== activeTabId);
    smooth.current = activeTabId;
  }, [activeTabId, slotX, slotW, shownLength]);

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
    let next: string | undefined;
    if (e.key === "ArrowRight") next = ids[(at + 1) % ids.length];
    else if (e.key === "ArrowLeft")
      next = ids[(at - 1 + ids.length) % ids.length];
    else if (e.key === "Home") next = ids[0];
    else if (e.key === "End") next = ids[ids.length - 1];
    else if (e.key === "Enter" || e.key === " ") onActivate(id!);
    else if (e.key === "Delete") {
      const near = ids[at + 1] ?? ids[at - 1];
      if (near) pillOf(near)?.focus();
      onClose(id!);
    } else return;
    e.preventDefault();
    if (next) pillOf(next)?.focus();
  }

  return (
    <div
      className={inner ? "tab-bar tab-bar-inner" : "tab-bar"}
      style={style}
      // In the window bar's row, its empty stretch still moves the window.
      data-tauri-drag-region={inner ? undefined : true}
      data-pane-id={paneId}
      data-overflow={overflow || undefined}
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
              ((id, title) => {
                strip.dragEnd(id, 0);
                onPullOut(id, title);
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
      <Presence show={menu !== null} exitMs={120}>
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
          onClick={onAdd}
        >
          +
        </button>
      </Tooltip>
      {overflow && (
        <TabListButton
          tabs={tabs}
          activeTabId={activeTabId}
          onActivate={onActivate}
          label={labels.all}
        />
      )}
    </div>
  );
}

/**
 * Scrolls the row alone (never the page) to bring `slot` into the part of
 * it that shows, `shown` long from where it is scrolled to.
 */
function reveal(bar: HTMLElement, slot: Slot, shown: number, smooth: boolean) {
  const margin = 12;
  const from = bar.scrollLeft;
  const behavior = smooth ? scrollBehavior() : "auto";
  if (slot.x < from + margin)
    bar.scrollTo({ left: Math.max(0, slot.x - margin), behavior });
  else if (slot.x + slot.w > from + shown - margin)
    bar.scrollTo({ left: slot.x + slot.w - shown + margin, behavior });
}
