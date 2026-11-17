import { animate } from "../motion/motion";
import { contentZoom } from "../zoom/tab-zoom";
import { asDrawn, zoomedRectScale } from "../zoom/zoomed-rects";
/**
 * The copy that follows the pointer while something is moved somewhere
 * else (a tab pulled out to split the window, a file dragged in the tree):
 * one look and one place for every such drag, centred under the pointer as
 * the pill between windows is (tab_drag/pill.rs). Reordering within a row
 * moves the thing itself instead (pointer-drag.ts).
 */
interface DragGhost {
  move(x: number, y: number): void;
  /** Out of sight while something else follows the pointer instead. */
  hide(hidden: boolean): void;
  /** Gathers in from `from` (the tab it was) to the pointer: the tuck
   *  spring. */
  gather(from: DOMRect): void;
  /** Flies to `to`'s start and fades there (the land spring), then goes. */
  land(to: DOMRect): void;
  remove(): void;
}

/** The move that puts `ghost`, where it is, at `rect`'s start: never
 *  scaled - grown to an island's size, its words blurred across it. */
function toward(ghost: HTMLElement, rect: DOMRect): Keyframe {
  const box = ghost.getBoundingClientRect();
  const dx = rect.left - box.left;
  const dy =
    rect.top +
    Math.min(rect.height, box.height) / 2 -
    (box.top + box.height / 2);
  return { transform: `translate(${dx}px, ${dy}px)` };
}

/** A copy flown along `frames` and faded there (the land spring), then
 *  `done`. */
function landAlong(copy: HTMLElement, frames: Keyframe[], done: () => void) {
  const flight = animate(copy, frames, {
    duration: "--dur-land",
    easing: "--ease-land",
    fill: "forwards",
  });
  if (flight) void flight.finished.finally(done);
  else done();
}

export function dragGhost(text: string, className: string): DragGhost {
  const ghost = document.createElement("div");
  ghost.className = `drag-ghost ${className}`;
  ghost.textContent = text;
  ghost.setAttribute("aria-hidden", "true");
  document.body.append(ghost);
  // By `translate`, not `transform`: the lifted look's `scale` would
  // scale a transform's offset too, and the copy drift off the pointer.
  const move = (x: number, y: number) => {
    ghost.style.translate = `${x - ghost.offsetWidth / 2}px ${y - ghost.offsetHeight / 2}px`;
  };
  return {
    move,
    hide(hidden) {
      ghost.style.visibility = hidden ? "hidden" : "";
    },
    gather(from) {
      // Where the tab was, before the first move: measured from the
      // window's corner, the tuck flew in from far off.
      move(from.left + from.width / 2, from.top + from.height / 2);
      animate(ghost, [toward(ghost, from), { transform: "none" }], {
        duration: "--dur-tuck",
        easing: "--ease-tuck",
      });
    },
    land(to) {
      landAlong(
        ghost,
        [{ transform: "none" }, { ...toward(ghost, to), opacity: 0 }],
        () => ghost.remove(),
      );
    },
    remove() {
      ghost.remove();
    },
  };
}

/** `v` on a whole device pixel. */
const onPixel = (v: number) => {
  const dpr = window.devicePixelRatio || 1;
  return Math.round(v * dpr) / dpr;
};

/** A copy of `node` lifted where it is, carried by the pointer `dx, dy`
 *  from there, so it stays under the point it was taken by: for an item
 *  its own clipping box would hide (a rail icon, a document's block that
 *  may land in another document). `wrap` puts the copy inside what gives
 *  it its look (a block's list and editor); it is drawn at `node`'s zoom,
 *  and with `fit` only as wide as what it holds.
 *  The item itself is left hidden until the copy goes, unless `keep`. */
export function liftedCopy(
  node: HTMLElement,
  {
    wrap,
    keep = false,
    fit = false,
    className = "",
  }: {
    wrap?: (copy: HTMLElement) => HTMLElement;
    keep?: boolean;
    /** As wide as its content, at most `node`'s width. */
    fit?: boolean;
    className?: string;
  } = {},
): {
  /** What follows the pointer. */
  readonly element: HTMLElement;
  moveBy(dx: number, dy: number): void;
  /** Flies to `to`'s start and fades there (the land spring), then goes. */
  land(to: DOMRect): void;
  remove(): void;
} {
  const box = asDrawn(node.getBoundingClientRect(), zoomedRectScale(node));
  const zoom = contentZoom(node);
  const copy = node.cloneNode(true) as HTMLElement;
  for (const attr of [...copy.attributes])
    if (attr.name.startsWith("data-") || attr.name === "id")
      copy.removeAttribute(attr.name);
  const lifted = wrap ? wrap(copy) : copy;
  lifted.setAttribute("aria-hidden", "true");
  lifted.classList.add("tx-drag-ghost", "is-lifted");
  if (className) lifted.classList.add(...className.split(" "));
  const width = `${(box.right - box.left) / zoom}px`;
  Object.assign(lifted.style, {
    left: "0",
    top: "0",
    ...(fit
      ? { maxWidth: width }
      : { width, height: `${(box.bottom - box.top) / zoom}px` }),
    transformOrigin: "0 0",
    transform: zoom === 1 ? "" : `scale(${zoom})`,
  });
  let at = { dx: 0, dy: 0 };
  const moveBy = (dx: number, dy: number) => {
    at = { dx, dy };
    // On whole device pixels: placed between them, the lifted layer is
    // drawn blurred.
    lifted.style.translate = `${onPixel(box.left + dx)}px ${onPixel(box.top + dy)}px`;
  };
  moveBy(0, 0);
  document.body.append(lifted);
  if (!keep) node.style.visibility = "hidden";
  const remove = () => {
    lifted.remove();
    if (!keep) node.style.visibility = "";
  };
  return {
    element: lifted,
    moveBy,
    land(to) {
      landAlong(
        lifted,
        [
          { translate: `${box.left + at.dx}px ${box.top + at.dy}px` },
          { translate: `${to.left}px ${to.top}px`, opacity: 0 },
        ],
        remove,
      );
    },
    remove,
  };
}
