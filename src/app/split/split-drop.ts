import {
  moveToPane,
  pairLayout,
  paneOf,
  setSplitLayout,
  splitLayout,
  type SplitDirection,
} from "./split-layout";
import type { DocumentDrop } from "../../ui/document-drop";
import "./split-drop.css";

/**
 * The side of the document a dragged tab or file would open on; the middle
 * just brings it to the front.
 */
export type DropZone = "left" | "right" | "top" | "bottom" | "center";

export interface DropTarget {
  zone: DropZone;
  /** The tab whose document is under the pointer. */
  tabId: string;
  /** Where that document is drawn. */
  rect: DOMRect;
}

/** How near an edge (a share of the width or height) still counts as it. */
const EDGE = 0.3;

/** The zone of the document under (x, y); null off the documents. */
export function dropTargetAt(x: number, y: number): DropTarget | null {
  const main = document.querySelector<HTMLElement>(".main-pane");
  if (!main) return null;
  const panes = [...main.querySelectorAll<HTMLElement>(":scope > .split-pane")];
  let rect: DOMRect;
  let tabId: string | undefined;
  if (panes.length) {
    const pane = panes.find((p) => inside(p.getBoundingClientRect(), x, y));
    if (!pane) return null;
    rect = pane.getBoundingClientRect();
    tabId = pane.dataset.tabId;
  } else {
    // One document: the column below the tab bar.
    const box = main.getBoundingClientRect();
    const bar = main.querySelector(":scope > .tab-bar");
    const top = bar ? bar.getBoundingClientRect().bottom : box.top;
    rect = new DOMRect(box.left, top, box.width, box.bottom - top);
    tabId = main.querySelector<HTMLElement>(':scope > [data-active-tab="true"]')
      ?.dataset.tabId;
  }
  if (!tabId || !inside(rect, x, y)) return null;
  const fx = (x - rect.left) / rect.width;
  const fy = (y - rect.top) / rect.height;
  const near = Math.min(fx, 1 - fx, fy, 1 - fy);
  const zone: DropZone =
    near > EDGE
      ? "center"
      : near === fx
        ? "left"
        : near === 1 - fx
          ? "right"
          : near === fy
            ? "top"
            : "bottom";
  return { zone, tabId, rect };
}

function inside(rect: DOMRect, x: number, y: number): boolean {
  return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
}

let hint: HTMLDivElement | null = null;

/** Lights up where a drop at `target` would put the document; null
 *  takes the light away. */
export function showDropHint(target: DropTarget | null): void {
  if (!target) {
    hint?.remove();
    hint = null;
    return;
  }
  if (!hint) {
    hint = document.createElement("div");
    hint.className = "split-drop-hint";
    hint.setAttribute("aria-hidden", "true");
    document.body.append(hint);
  }
  const { rect, zone } = target;
  const half = (w: number) => w / 2;
  const box = {
    left: zone === "right" ? rect.left + half(rect.width) : rect.left,
    top: zone === "bottom" ? rect.top + half(rect.height) : rect.top,
    width: zone === "left" || zone === "right" ? half(rect.width) : rect.width,
    height:
      zone === "top" || zone === "bottom" ? half(rect.height) : rect.height,
  };
  Object.assign(hint.style, {
    left: `${box.left}px`,
    top: `${box.top}px`,
    width: `${box.width}px`,
    height: `${box.height}px`,
  });
}

/**
 * Puts `tabId` where it was dropped. Already split, it moves into the pane
 * it was dropped on (an edge counts as that side's pane). Otherwise an edge
 * splits the window, and a tab dropped on its own document pairs with a
 * neighbour. Call once `tabId` is among the window's tabs and in front.
 */
export function splitForDrop(
  tabId: string,
  target: DropTarget,
  tabIds: readonly string[],
): void {
  const now = splitLayout();
  if (now?.panes[1]) {
    const pane = paneOf(now, target.tabId);
    if (pane !== null) moveToPane(tabId, pane);
    return;
  }
  if (target.zone === "center") return;
  let other = target.tabId;
  if (other === tabId) {
    const at = tabIds.indexOf(tabId);
    other = tabIds[at + 1] ?? tabIds[at - 1];
    if (!other) return;
  }
  const direction: SplitDirection =
    target.zone === "left" || target.zone === "right" ? "row" : "column";
  const first = target.zone === "left" || target.zone === "top";
  // The window's other tabs stay with the document dropped beside, in
  // their order.
  const rest = tabIds.filter((id) => id !== tabId);
  const layout = first
    ? pairLayout(direction, tabId, other, 1)
    : pairLayout(direction, other, tabId, 0);
  layout.groups = first ? [[tabId], rest] : [rest, [tabId]];
  setSplitLayout(layout);
}

/**
 * A tab pulled down out of the tab bar, followed to its drop: over a
 * document it splits there, out of the window it tears off where possible.
 * Escape cancels.
 */
export function pullTab(
  tabId: string,
  title: string,
  opts: {
    tabIds: readonly string[];
    activate: (id: string) => void;
    detach?: (id: string) => void;
    /** Let go outside the window, where `detach` can't follow the pointer. */
    releaseOutside?: (id: string) => void;
  },
): void {
  const ghost = document.createElement("div");
  ghost.className = "tab-pull-ghost";
  ghost.textContent = title;
  ghost.setAttribute("aria-hidden", "true");
  document.body.append(ghost);
  document.body.classList.add("tab-pulling");
  const outside = (e: PointerEvent) =>
    e.clientX < 0 ||
    e.clientY < 0 ||
    e.clientX > window.innerWidth ||
    e.clientY > window.innerHeight;
  const move = (e: PointerEvent) => {
    if (opts.detach && outside(e)) {
      stop();
      opts.detach(tabId);
      return;
    }
    ghost.style.transform = `translate(${e.clientX + 12}px, ${e.clientY + 8}px)`;
    showDropHint(dropTargetAt(e.clientX, e.clientY));
  };
  const up = (e: PointerEvent) => {
    const target = dropTargetAt(e.clientX, e.clientY);
    stop();
    if (opts.releaseOutside && outside(e)) {
      opts.releaseOutside(tabId);
      return;
    }
    if (!target) return;
    opts.activate(tabId);
    // Once it is in front, the next frame: the split takes it from there.
    requestAnimationFrame(() => splitForDrop(tabId, target, opts.tabIds));
  };
  const key = (e: KeyboardEvent) => {
    if (e.key === "Escape") stop();
  };
  function stop() {
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", up);
    window.removeEventListener("pointercancel", stop);
    window.removeEventListener("keydown", key, true);
    ghost.remove();
    document.body.classList.remove("tab-pulling");
    showDropHint(null);
  }
  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", up);
  window.addEventListener("pointercancel", stop);
  window.addEventListener("keydown", key, true);
}

/** What a sidebar file dragged over the documents does: `open` gets where
 *  it was let go. */
export function fileDropOnDocuments(
  open: (path: string, target: DropTarget) => void,
): DocumentDrop {
  return {
    over(x, y) {
      const target = dropTargetAt(x, y);
      showDropHint(target);
      return !!target;
    },
    leave: () => showDropHint(null),
    drop(path, x, y) {
      const target = dropTargetAt(x, y);
      showDropHint(null);
      if (!target) return false;
      open(path, target);
      return true;
    },
  };
}
