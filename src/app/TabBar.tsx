import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  type RefObject,
} from "react";
import { CloseIcon } from "../ui/icons";
import { usePhoneLayout } from "../ui/usePhoneLayout";
import { animate, scrollBehavior } from "../ui/motion";
import { ListMotion, measure, play, type PendingFlip } from "../ui/flip";
import { Tooltip } from "../ui/Tooltip";

interface TabInfo {
  id: string;
  // Display name, computed by App (filename, "Untitled", or a bundled
  // Help document's localized title).
  title: string;
  dirty: boolean;
}

interface TabBarProps {
  tabs: TabInfo[];
  activeTabId: string;
  onActivate: (id: string) => void;
  onClose: (id: string) => void;
  onAdd: () => void;
  // Fired ONCE when a pill is pulled past the detach threshold: the tab
  // leaves this window at that moment (App.tsx hands its document to
  // Rust's floating-tab drag and removes it here) - there is no
  // move/end tracking on this side, the native drag owns the rest.
  /** Tear-off is macOS-only (tab_drag.rs); elsewhere omitted, and a
   *  vertical pull stays an ordinary reorder gesture. */
  onDetach?: (id: string) => void;
  // Horizontal drag-to-reorder within this bar: move the tab with the
  // given id so it sits at `index` among the OTHER tabs.
  onReorder: (id: string, index: number) => void;
  // A tab being dragged INTO (or over) this window's tab row - the
  // floating drag emits it while hovering, x already window-local - shown
  // as a real-looking pill riding the cursor along the bar, the existing
  // tabs sliding out of its way, exactly like a within-bar reorder. On
  // release it becomes the real tab in that same slot.
  previewTab: { title: string; dirty: boolean; x: number } | null;
  /** What the icon-only buttons' tooltips and a screen reader say. */
  labels: { tabs: string; close: string; add: string; unsaved: string };
}

// How far a tab must be dragged vertically, away from the bar, before it
// detaches into a floating tab; and how far horizontally before the same
// press starts a within-bar reorder instead. dy always wins - pulling down
// mid-reorder still detaches, like Chrome.
const DETACH_THRESHOLD_PX = 40;
const REORDER_THRESHOLD_PX = 5;

// One slide for every pill making way in the bar (live reorder shifting,
// an incoming tab passing over them), so overlapping moves read as one.
// No travel under reduced motion: the pills step to their places.
const SLIDE =
  "transform calc(var(--dur-base) * var(--motion-travel)) var(--ease-in-out)";

export function TabBar({
  tabs,
  activeTabId,
  onActivate,
  onClose,
  onAdd,
  onDetach,
  onReorder,
  previewTab,
  labels,
}: TabBarProps) {
  const barRef = useRef<HTMLDivElement>(null);

  // A phone shows two or three pills at a time, and the tab that just
  // opened (a new file, a document picked from the list) lands at the end
  // of the row, out of sight. Bring the active one into view - by scrolling
  // the bar alone, so the page under it never moves.
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

  // FLIP (ListMotion, below): a gesture here that is about to change the
  // bar - a reorder landing, a tab tearing off - captures the CURRENT
  // on-screen place of every pill first, mid-shift transforms included, so
  // the commit's slides start from exactly where things were.
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

  // A tab list: ← / → (and Home / End) move between the tabs, Enter or
  // Space shows the one with the focus, Delete closes it. Only the tab in
  // front is in the tab order.
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
      // The focus stays in the strip, on the neighbour that takes the
      // closed tab's place.
      (pills[at + 1] ?? pills[at - 1])?.focus();
      onClose(id);
    } else return;
    e.preventDefault();
    next?.focus();
  }

  return (
    <div
      className="tab-bar"
      ref={barRef}
      role="tablist"
      aria-label={labels.tabs}
      onKeyDown={onKeyDown}
    >
      {/* Pills glide aside for a new tab and close up behind a closed
          one, which shrinks away in its old place; a new one pops in. */}
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
          onDetach={onDetach}
          onReorder={onReorder}
          captureFlip={captureFlip}
        />
      ))}
      {previewTab && (
        <div
          className="tab-pill tab-pill-active tab-pill-preview"
          ref={previewRef}
        >
          {previewTab.dirty && <span className="tab-pill-dirty-dot" />}
          <span className="tab-pill-title">{previewTab.title}</span>
        </div>
      )}
      {/* The pointer's File › New File (Ctrl/⌘ + N, the keyboard's): a tab
        list holds only tabs, so it stays out of the list's tree. */}
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
 * THE INCOMING TAB, riding the bar. The preview pill is laid out at the
 * end of the row but rendered (via transform) wherever the cursor is;
 * every other pill (and the + button) slides one slot right the moment
 * the cursor passes left of its center, and slides home when it passes
 * back - the same give-way behavior as a local reorder drag, driven by
 * Rust's hover events instead of pointer events. Give-way decisions
 * always compare against hoverGeom - each pill's resting layout
 * position, measured ONCE when the hover starts - never against live
 * rects: a rect read mid-slide underestimates/overestimates the layout
 * position, and near a decision boundary (e.g. hugging the bar's left
 * edge, where the clamped cursor parks right at the first pill's
 * center) that misread flips the decision back and forth, visible as
 * pills jittering in and out.
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
        // Hover (re)started: settle any leftover animation instantly so
        // the measurements below read true resting layout, then capture
        // it once for the whole hover.
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

      // Center the preview on the cursor, clamped inside the bar. The
      // preview itself always moves with transition:none, so its rect
      // minus its own known tx IS its resting layout - no misread risk.
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
        // The drop: the real tab was inserted at the hovered slot in this
        // same render, so the shifted pills' new LAYOUT matches where
        // they already are visually - clear their transforms with no
        // transition and nothing moves. The arriving pill itself settles
        // from the preview's last position into its slot.
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

interface PillRect {
  id: string;
  center: number;
  width: number;
}

function TabPill({
  tab,
  tabIds,
  isActive,
  labels,
  onActivate,
  onClose,
  onDetach,
  onReorder,
  captureFlip,
}: {
  tab: TabInfo;
  tabIds: string[];
  isActive: boolean;
  labels: TabBarProps["labels"];
  onActivate: (id: string) => void;
  onClose: (id: string) => void;
  onDetach?: (id: string) => void;
  onReorder: (id: string, index: number) => void;
  captureFlip: (how: { dropped?: string; gone?: string }) => void;
}) {
  const elRef = useRef<HTMLDivElement>(null);
  const gesture = useRef<{
    startX: number;
    startY: number;
    reordering: boolean;
    // Layout (untransformed) geometry of every real pill, measured once
    // when the reorder starts - live shifting compares against these, not
    // against mid-animation positions.
    rects: PillRect[];
    gap: number;
  } | null>(null);
  const title = tab.title;

  const pillNode = (id: string): HTMLElement | null =>
    elRef.current?.parentElement?.querySelector<HTMLElement>(
      `[data-flip-id="${CSS.escape(id)}"]`,
    ) ?? null;

  function clearInlineStyles() {
    for (const id of tabIds) {
      const node = pillNode(id);
      if (!node) continue;
      node.style.transition = "";
      node.style.transform = "";
      node.style.zIndex = "";
    }
  }

  function handlePointerDown(e: React.PointerEvent<HTMLDivElement>) {
    if (e.button !== 0) return;
    gesture.current = {
      startX: e.clientX,
      startY: e.clientY,
      reordering: false,
      rects: [],
      gap: 0,
    };
    e.currentTarget.setPointerCapture(e.pointerId);
  }

  function handlePointerMove(e: React.PointerEvent<HTMLDivElement>) {
    const g = gesture.current;
    if (!g) return;

    if (onDetach && Math.abs(e.clientY - g.startY) > DETACH_THRESHOLD_PX) {
      // Pulled out of the bar - this pill is about to be removed
      // entirely, so any live reorder shifting on the neighbors must not
      // survive it; the FLIP capture right before removal is what makes
      // the survivors glide into the gap.
      gesture.current = null;
      clearInlineStyles();
      captureFlip({ gone: tab.id });
      onDetach(tab.id);
      return;
    }

    const dx = e.clientX - g.startX;
    if (!g.reordering) {
      if (Math.abs(dx) < REORDER_THRESHOLD_PX) return;
      g.reordering = true;
      g.rects = tabIds
        .map((id) => {
          const node = pillNode(id);
          if (!node) return null;
          // offsetLeft/offsetWidth are layout values, immune to any
          // transform already in flight from a previous animation.
          return {
            id,
            center: node.offsetLeft + node.offsetWidth / 2,
            width: node.offsetWidth,
          };
        })
        .filter((r): r is PillRect => r !== null);
      const bar = elRef.current?.parentElement;
      g.gap = bar ? parseFloat(getComputedStyle(bar).columnGap) || 0 : 0;
    }

    const el = elRef.current;
    const mine = g.rects.find((r) => r.id === tab.id);
    if (!el || !mine) return;
    el.style.transition = "none";
    el.style.transform = `translateX(${dx}px)`;
    el.style.zIndex = "10";

    // Everything the dragged pill's center has passed slides out of its
    // way by exactly one dragged-pill slot; everything else slides home.
    const center = mine.center + dx;
    const slot = mine.width + g.gap;
    for (const r of g.rects) {
      if (r.id === tab.id) continue;
      const node = pillNode(r.id);
      if (!node) continue;
      let shift = 0;
      if (r.center < mine.center && center < r.center) shift = slot;
      else if (r.center > mine.center && center > r.center) shift = -slot;
      node.style.transition = SLIDE;
      node.style.transform = shift ? `translateX(${shift}px)` : "";
    }
  }

  function handlePointerUp(e: React.PointerEvent<HTMLDivElement>) {
    const g = gesture.current;
    gesture.current = null;
    if (!g) return;
    if (!g.reordering) {
      onActivate(tab.id);
      return;
    }
    // Land the reorder: the drop index is however many OTHER pills the
    // dragged center ended up past. FLIP is captured from the current
    // VISUAL positions (mid-shift transforms included), so committing the
    // new order and clearing the inline styles in the same breath lets
    // every pill glide from exactly where it was to its final slot.
    const mine = g.rects.find((r) => r.id === tab.id);
    const center = (mine?.center ?? 0) + (e.clientX - g.startX);
    const index = g.rects.filter(
      (r) => r.id !== tab.id && r.center < center,
    ).length;
    if (index === tabIds.indexOf(tab.id)) {
      // Back in its own slot: no commit will follow to play the slides,
      // so they play here.
      const bar = elRef.current?.parentElement;
      const rects = measure(bar?.querySelectorAll("[data-flip-id]") ?? []);
      clearInlineStyles();
      play(rects, {
        timingFor: (el) =>
          el === elRef.current
            ? { duration: "--dur-medium", easing: "--ease-spring-bouncy" }
            : undefined,
      });
    } else {
      captureFlip({ dropped: tab.id });
      clearInlineStyles();
    }
    onReorder(tab.id, index);
  }

  return (
    <div
      ref={elRef}
      data-flip-id={tab.id}
      className={`tab-pill ${isActive ? "tab-pill-active" : ""}`}
      role="tab"
      aria-selected={isActive}
      tabIndex={isActive ? 0 : -1}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      // Without this, WebKit treats the press as the start of a text
      // selection and paints a selection sweep through the editor below
      // once the pill detaches mid-gesture.
      onMouseDown={(e) => e.preventDefault()}
      // Entered once: a reorder moves the pill's node, and a moved node
      // starts its stylesheet animation over - the dropped tab faded in
      // from nothing while its neighbour slid under it (TabBar.css).
      onAnimationEnd={(e) => {
        if (e.target === e.currentTarget) e.currentTarget.dataset.entered = "";
      }}
    >
      {tab.dirty && (
        <span
          className="tab-pill-dirty-dot"
          role="img"
          aria-label={labels.unsaved}
        />
      )}
      <span className="tab-pill-title">{title}</span>
      {/* The pointer's close; the keyboard's is Delete on the tab (or
        Ctrl/⌘ + W). Not a button: a tab holds no control of its own. */}
      <Tooltip text={labels.close} description={null}>
        <span
          className="tab-pill-close"
          aria-hidden="true"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            onClose(tab.id);
          }}
        >
          <CloseIcon />
        </span>
      </Tooltip>
    </div>
  );
}
