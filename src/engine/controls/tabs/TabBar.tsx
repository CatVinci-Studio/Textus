import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type RefObject,
  type CSSProperties,
} from "react";
import { animate } from "../../motion/motion";
import { ListMotion, measure, type PendingFlip } from "../../motion/flip";
import { Tooltip } from "../Tooltip";
import { ContextMenu, type ContextMenuEntry } from "../ContextMenu";
import { Presence } from "../../motion/usePresence";
import { TabPill, type TabInfo } from "./TabPill";
import { revealActive, TabListButton, useTabFit } from "./TabList";
import { roomFor, SLIDE } from "../../drag/row";

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
  const [menu, setMenu] = useState<{
    x: number;
    y: number;
    items: ContextMenuEntry[];
  } | null>(null);

  // The open tab in view, as it changes (and as the row narrows: TabList).
  useEffect(() => {
    if (barRef.current) revealActive(barRef.current, true);
  }, [activeTabId, tabs.length]);

  // FLIP: capture every pill's on-screen place, mid-shift transforms
  // included, before a gesture changes the bar.
  const pendingFlip = useRef<PendingFlip | null>(null);

  const captureFlip = useCallback(
    (how: { dropped?: string; gone?: string }) => {
      const bar = barRef.current;
      if (!bar) return;
      pendingFlip.current = {
        rects: measure(bar.querySelectorAll("[data-flip-id]")),
        ...how,
      };
    },
    [],
  );

  const previewRef = useIncomingTabPreview(barRef, previewTab, tabs);
  const fit = useTabFit(barRef, tabs, previewTab !== null);
  // One tab too long for its row is cut short, not listed: a list of one
  // tells nothing.
  const overflow = !!fit?.overflow && tabs.length > 1;

  // Tab-list keys: arrows/Home/End move, Enter/Space shows, Delete closes.
  // Only the front tab is in the tab order.
  function onKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    const pills = Array.from(
      barRef.current?.querySelectorAll<HTMLElement>('[role="tab"]') ?? [],
    );
    const at = pills.indexOf(e.target as HTMLElement);
    if (at === -1 || e.altKey || e.ctrlKey || e.metaKey) return;
    const id = pills[at].dataset.flipId!;
    let next: HTMLElement | undefined;
    if (e.key === "ArrowRight") next = pills[(at + 1) % pills.length];
    else if (e.key === "ArrowLeft")
      next = pills[(at - 1 + pills.length) % pills.length];
    else if (e.key === "Home") next = pills[0];
    else if (e.key === "End") next = pills[pills.length - 1];
    else if (e.key === "Enter" || e.key === " ") onActivate(id);
    else if (e.key === "Delete") {
      (pills[at + 1] ?? pills[at - 1])?.focus();
      onClose(id);
    } else return;
    e.preventDefault();
    next?.focus();
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
      <ListMotion
        ids={tabs.map((tab) => tab.id)}
        container={barRef}
        ghostClass="tab-pill-ghost"
        exitMs={150}
        pending={pendingFlip}
      />
      {tabs.map((tab, i) => (
        <TabPill
          key={tab.id}
          tab={tab}
          width={fit?.widths[i]}
          cut={fit?.cut[i]}
          tabIds={tabs.map((t) => t.id)}
          isActive={tab.id === activeTabId}
          labels={labels}
          onUnlock={onUnlock}
          onActivate={onActivate}
          onClose={onClose}
          onPullOut={onPullOut}
          onReorder={onReorder}
          onKeep={onKeep}
          captureFlip={captureFlip}
          onMenu={
            menuFor && ((x, y) => setMenu({ x, y, items: menuFor(tab.id) }))
          }
        />
      ))}
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
      {previewTab && (
        <div
          className="tab-pill tab-pill-active tab-pill-preview"
          ref={previewRef}
        >
          {previewTab.dirty && <span className="tab-pill-dirty-dot" />}
          <span className="tab-pill-title">{previewTab.title}</span>
        </div>
      )}
      {/* A tab list holds only tabs, so this stays out of its tree. */}
      <Tooltip text={labels.add} description={null}>
        <button
          className="tab-bar-add"
          data-flip-id="__add__"
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
 * The incoming tab, riding the bar while another window drags it over.
 * Give-way decisions compare against resting positions measured once at
 * hover start: live rects mid-slide make pills jitter at a boundary.
 */
function useIncomingTabPreview(
  barRef: RefObject<HTMLDivElement | null>,
  previewTab: TabBarProps["previewTab"],
  tabs: TabBarProps["tabs"],
) {
  const previewRef = useRef<HTMLDivElement>(null);
  const appliedShift = useRef(new Map<string, number>());
  const hoverGeom = useRef<{
    forTabs: string;
    centers: Map<string, number>;
  } | null>(null);
  const previewState = useRef<{
    hadPreview: boolean;
    tabIds: string[];
    previewLeft: number;
  }>({
    hadPreview: false,
    tabIds: [],
    previewLeft: 0,
  });

  useLayoutEffect(() => {
    const bar = barRef.current;
    if (!bar) return;
    const prev = previewState.current;
    const slidables = Array.from(
      bar.querySelectorAll<HTMLElement>("[data-flip-id]"),
    );

    if (previewTab) {
      const el = previewRef.current;
      if (!el) return;

      const tabsKey = tabs.map((tab) => tab.id).join("\n");
      if (hoverGeom.current?.forTabs !== tabsKey) {
        // Hover (re)started: settle leftover animation so the measurements
        // read the resting layout.
        for (const node of slidables) {
          node.style.transition = "none";
          node.style.transform = "";
          for (const running of node.getAnimations?.() ?? []) running.cancel();
        }
        appliedShift.current.clear();
        const centers = new Map<string, number>();
        for (const node of slidables) {
          const r = node.getBoundingClientRect();
          centers.set(node.dataset.flipId!, r.left + r.width / 2);
        }
        hoverGeom.current = { forTabs: tabsKey, centers };
      }
      const geom = hoverGeom.current;

      // Center on the cursor, clamped. The preview never transitions, so
      // its rect minus its own tx is its resting layout.
      const rect = el.getBoundingClientRect();
      const prevTx = appliedShift.current.get("__preview__") ?? 0;
      const layoutCenter = rect.left - prevTx + rect.width / 2;
      const barRect = bar.getBoundingClientRect();
      const x = Math.min(
        Math.max(previewTab.x, barRect.left + rect.width / 2),
        barRect.right - rect.width / 2,
      );
      const tx = x - layoutCenter;
      el.style.transition = "none";
      el.style.transform = `translateX(${tx}px)`;
      appliedShift.current.set("__preview__", tx);
      prev.previewLeft = x - rect.width / 2;

      const slot =
        rect.width + (parseFloat(getComputedStyle(bar).columnGap) || 0);
      const room = roomFor(geom.centers, x, slot);
      for (const node of slidables) {
        const id = node.dataset.flipId!;
        if (!room.has(id)) continue;
        const shifted = appliedShift.current.get(id) ?? 0;
        const shift = room.get(id)!;
        if (shift !== shifted) {
          node.style.transition = SLIDE;
          node.style.transform = shift ? `translateX(${shift}px)` : "";
          appliedShift.current.set(id, shift);
        }
      }
    } else if (prev.hadPreview) {
      const landed = tabs.some((tab) => !prev.tabIds.includes(tab.id));
      if (landed) {
        // The real tab was inserted at the hovered slot in this render, so
        // clearing transforms with no transition moves nothing.
        for (const node of slidables) {
          node.style.transition = "none";
          node.style.transform = "";
        }
        const arrivedId = tabs.find((tab) => !prev.tabIds.includes(tab.id))!.id;
        const arrived = bar.querySelector<HTMLElement>(
          `[data-flip-id="${CSS.escape(arrivedId)}"]`,
        );
        if (arrived) {
          arrived.style.animation = "none"; // the pop-in would fight the settle
          const delta = prev.previewLeft - arrived.getBoundingClientRect().left;
          // Let go over the bar: it lands on a spring.
          if (Math.abs(delta) > 0.5)
            animate(
              arrived,
              [{ transform: `translateX(${delta}px)` }, { transform: "none" }],
              { duration: "--dur-base", easing: "--ease-spring-bouncy" },
            );
        }
      } else {
        // Hover left without dropping: everyone slides home.
        for (const node of slidables) {
          node.style.transition = SLIDE;
          node.style.transform = "";
        }
      }
      appliedShift.current.clear();
      hoverGeom.current = null;
    }

    prev.hadPreview = previewTab !== null;
    prev.tabIds = tabs.map((tab) => tab.id);
  }, [barRef, previewTab, tabs]);
  return previewRef;
}
