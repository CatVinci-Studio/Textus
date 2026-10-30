import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type RefObject,
  type CSSProperties,
} from "react";
import { usePhoneLayout } from "../../ui/usePhoneLayout";
import { animate, scrollBehavior } from "../../ui/motion";
import { ListMotion, measure, type PendingFlip } from "../../ui/flip";
import { Tooltip } from "../../ui/Tooltip";
import { ContextMenu, type ContextMenuItem } from "../../ui/ContextMenu";
import { Presence } from "../../ui/usePresence";
import { SLIDE, TabPill, type TabInfo } from "./TabPill";

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
  // A tab dragged in from another window, shown as a pill riding the
  // cursor; on release it becomes the real tab in that slot.
  previewTab: { title: string; dirty: boolean; x: number } | null;
  /** A tab's right-click menu (Open to the Side, Close). */
  menuFor?: (id: string) => (ContextMenuItem | "separator")[];
  /** What the icon-only buttons' tooltips and a screen reader say. */
  labels: { tabs: string; close: string; add: string; unsaved: string };
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
  previewTab,
  menuFor,
  labels,
  style,
  paneId,
  inner,
}: TabBarProps) {
  const barRef = useRef<HTMLDivElement>(null);
  const [menu, setMenu] = useState<{
    x: number;
    y: number;
    items: (ContextMenuItem | "separator")[];
  } | null>(null);

  // A phone shows two or three pills; scroll the bar alone (never the page)
  // to bring the active tab into view.
  const phone = usePhoneLayout();
  useEffect(() => {
    if (!phone) return;
    const bar = barRef.current;
    const pill = bar?.querySelector<HTMLElement>(
      `[data-flip-id="${CSS.escape(activeTabId)}"]`,
    );
    if (!bar || !pill) return;
    const barBox = bar.getBoundingClientRect();
    const pillBox = pill.getBoundingClientRect();
    const margin = 12;
    const behavior = scrollBehavior();
    if (pillBox.left < barBox.left + margin)
      bar.scrollBy({ left: pillBox.left - barBox.left - margin, behavior });
    else if (pillBox.right > barBox.right - margin)
      bar.scrollBy({ left: pillBox.right - barBox.right + margin, behavior });
  }, [phone, activeTabId, tabs.length]);

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
      data-pane-id={paneId}
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
      {tabs.map((tab) => (
        <TabPill
          key={tab.id}
          tab={tab}
          tabIds={tabs.map((t) => t.id)}
          isActive={tab.id === activeTabId}
          labels={labels}
          onActivate={onActivate}
          onClose={onClose}
          onPullOut={onPullOut}
          onReorder={onReorder}
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
      for (const node of slidables) {
        const id = node.dataset.flipId!;
        const center = geom.centers.get(id);
        if (center === undefined) continue;
        const shifted = appliedShift.current.get(id) ?? 0;
        const shift = center > x ? slot : 0;
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
              { duration: "--dur-medium", easing: "--ease-spring-bouncy" },
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
