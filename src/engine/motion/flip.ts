import { Component, type ReactNode, type RefObject } from "react";
import { removeWhenGone } from "./leave";
import {
  animate,
  length,
  motionAllowed,
  type DurationToken,
  type EasingToken,
} from "./motion";

/**
 * FLIP: moved list items slide from their old place to their new one on
 * transforms alone. `measure` in the event handler causing the change, then
 * `play` in a layout effect after React commits.
 */

type Snapshot = Map<Element, DOMRect>;

const FLIP_ID = "flip";

/** Where each element is on screen now, any slide in flight included -
 *  so a second change mid-slide continues from where things are. */
export function measure(elements: Iterable<Element>): Snapshot {
  const rects: Snapshot = new Map();
  for (const el of elements) rects.set(el, el.getBoundingClientRect());
  return rects;
}

/** The slides `play` started on `elements` stopped: each drawn at once
 *  where it is laid out. */
export function stopFlips(elements: Iterable<Element>): void {
  for (const el of elements)
    for (const running of el.getAnimations?.() ?? [])
      if (running.id === FLIP_ID) running.cancel();
}

type Timing = { duration?: DurationToken | number; easing?: EasingToken };

/** Slides every element of `before` that moved from its old place to its new
 *  one. `timingFor` gives one element its own timing. */
export function play(
  before: Snapshot,
  {
    duration = "--dur-settle",
    easing = "--ease-settle",
    timingFor,
    prepare,
    resizes,
    onTranslate = false,
    arrived,
  }: Timing & {
    timingFor?: (el: Element) => Timing | undefined;
    /** Ones that change size as they move and are only a box (an island's
     *  sheet): their size eases too, on the same clock - moved alone, an
     *  edge jumped while the rest slid. */
    resizes?: (el: Element) => boolean;
    /** Lays out what follows the change (measured lengths set as styles)
     *  before the new places are read: settled later, it jumped. */
    prepare?: () => void;
    /** Slides on `translate`, leaving the place an item rests at on its
     *  own `transform` (one making room for a dragged one) alone. */
    onTranslate?: boolean;
    /** Looked up after the change: those not on screen before it (rows a
     *  folder opened) come in just under where they show, as the rest make
     *  room - shown at once, they popped in while their neighbours slid. */
    arrived?: () => Iterable<Element>;
  } = {},
): void {
  if (!motionAllowed()) return;
  const targets = [...before.keys()].filter((el) => el.isConnected);
  // Slides still running were measured into `before`; they must not count
  // again in the new positions.
  stopFlips(targets);
  prepare?.();
  if (arrived) {
    const came = new Set<Element>();
    for (const el of arrived()) {
      const was = before.get(el);
      if (!was || unplaced(was)) came.add(el);
    }
    // One inside another that came comes with it: faded twice, it would lag.
    for (const el of came) {
      let up = el.parentElement;
      while (up && !came.has(up)) up = up.parentElement;
      if (!up) discloseIn(el);
    }
  }
  type Move = {
    el: Element;
    dx: number;
    dy: number;
    size?: [DOMRect, DOMRect];
  };
  const moves: Move[] = [];
  for (const el of targets) {
    const was = before.get(el)!;
    const now = el.getBoundingClientRect();
    // Not drawn before or after (a folded section): it has no place to
    // slide from or to - it arrives, or is gone.
    if (unplaced(was) || unplaced(now)) continue;
    const dx = was.left - now.left;
    const dy = was.top - now.top;
    const resized =
      !!resizes?.(el) &&
      (Math.abs(was.width - now.width) >= 0.5 ||
        Math.abs(was.height - now.height) >= 0.5);
    if (resized || Math.abs(dx) >= 0.5 || Math.abs(dy) >= 0.5)
      moves.push({ el, dx, dy, size: resized ? [was, now] : undefined });
  }
  // One inside another that slides too moves with it: only its own share
  // is its to play, or it would travel twice.
  const shift = new Map(moves.map((m) => [m.el, m]));
  const own = moves.map((move) => {
    for (let up = move.el.parentElement; up; up = up.parentElement) {
      const outer = shift.get(up);
      if (outer)
        return { ...move, dx: move.dx - outer.dx, dy: move.dy - outer.dy };
    }
    return move;
  });
  for (const { el, dx, dy, size } of own) {
    if (!size && Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) continue;
    const timing = timingFor?.(el);
    // Measured on screen; moved in its own units, which a zoom it is drawn
    // at (the document's) scales.
    const k = drawnScale(el);
    const box = (r: DOMRect) => ({
      width: `${r.width / k}px`,
      height: `${r.height / k}px`,
    });
    const from = onTranslate
      ? { translate: `${dx / k}px ${dy / k}px` }
      : { transform: `translate(${dx / k}px, ${dy / k}px)` };
    const to = onTranslate ? { translate: "0px 0px" } : { transform: "none" };
    animate(
      el,
      [
        { ...from, ...(size && box(size[0])) },
        { ...to, ...(size && box(size[1])) },
      ],
      {
        duration: timing?.duration ?? duration,
        easing: timing?.easing ?? easing,
        id: FLIP_ID,
      },
    );
  }
}

const unplaced = (box: DOMRect) => box.width === 0 && box.height === 0;

/** Something disclosed under what opened it: it settles down a short way
 *  into place as it fades in (motion-disclose-in), its room taken at once. */
function discloseIn(el: Element): void {
  const d = length("--motion-distance-sm");
  animate(
    el,
    [
      { opacity: 0, transform: `translateY(${-d}px)` },
      { opacity: 1, transform: "none" },
    ],
    { duration: "--dur-base", easing: "--ease-out" },
  );
}

/** How much bigger than laid out `el`'s place is drawn: the zoom it sits
 *  in, where the engine reports boxes as drawn; 1 where it reports them
 *  as laid out, or nothing scales it. */
function drawnScale(el: Element): number {
  const around = el.parentElement;
  const laid = around?.offsetWidth;
  if (!around || !laid) return 1;
  const k = around.getBoundingClientRect().width / laid;
  return Math.abs(k - 1) < 0.01 ? 1 : k;
}

/** What a removed element looked like and where it sat, taken before the
 *  commit that removes it. */
interface Ghost {
  node: HTMLElement;
  left: number;
  top: number;
  width: number;
  height: number;
}

/** A copy of `el` and its place in its offset parent, for an exit played
 *  after React has removed the original. */
function captureGhost(el: HTMLElement): Ghost {
  const node = el.cloneNode(true) as HTMLElement;
  // Not one of the list's own items: later measurements must not see it.
  node.removeAttribute("data-flip-id");
  node.removeAttribute("id");
  return {
    node,
    left: el.offsetLeft,
    top: el.offsetTop,
    width: el.offsetWidth,
    height: el.offsetHeight,
  };
}

/** Puts a captured copy back where its original was, out of the layout, until
 *  `className`'s animation ends or `exitMs`. `parent` must be the original's
 *  positioned offset parent; `under` puts the copy beneath the survivors. */
function releaseGhost(
  ghost: Ghost,
  parent: HTMLElement,
  className: string,
  exitMs: number,
  under = true,
): void {
  const { node } = ghost;
  node.classList.add(className);
  node.setAttribute("aria-hidden", "true");
  node.inert = true;
  Object.assign(node.style, {
    position: "absolute",
    left: `${ghost.left}px`,
    top: `${ghost.top}px`,
    width: `${ghost.width}px`,
    height: `${ghost.height}px`,
    margin: "0",
    pointerEvents: "none",
  });
  parent.insertBefore(node, under ? parent.firstChild : null);
  removeWhenGone(node, exitMs);
}

/** measure, `mutate` (a synchronous DOM change), play. */
export function flip(
  elements: Iterable<Element>,
  mutate: () => void,
  options?: Parameters<typeof play>[1],
): void {
  const before = measure(elements);
  mutate();
  play(before, options);
}

/**
 * The same, for a change with no event handler to measure in: every commit
 * in which `watch` changes is measured before and played after. A class,
 * because getSnapshotBeforeUpdate is the one hook that runs before the DOM changes.
 */
export class FlipOnChange extends Component<{
  watch: unknown;
  /** The elements to slide, looked up at measuring time. */
  targets: () => Iterable<Element>;
  duration?: DurationToken | number;
  easing?: EasingToken;
  /** True while the change follows the pointer itself: no slide. */
  still?: () => boolean;
  /** See play's `prepare`. */
  prepare?: () => void;
  /** See play's `resizes`. */
  resizes?: (el: Element) => boolean;
  /** New targets after the change come in (play's `arrived`). */
  enters?: boolean;
}> {
  getSnapshotBeforeUpdate(previous: { watch: unknown }): Snapshot | null {
    if (
      Object.is(previous.watch, this.props.watch) ||
      !motionAllowed() ||
      this.props.still?.()
    )
      return null;
    return measure(this.props.targets());
  }

  componentDidUpdate(_: unknown, __: unknown, before: Snapshot | null) {
    if (!before) return;
    // After the commit's other layout effects (a parent's may be what moves the
    // layout), but before the frame is painted.
    const { duration, easing, prepare, resizes, enters, targets } = this.props;
    const arrived = enters ? targets : undefined;
    queueMicrotask(() =>
      play(before, { duration, easing, prepare, resizes, arrived }),
    );
  }

  render(): ReactNode {
    return null;
  }
}

/**
 * The motion of a keyed list across a commit that changes its items or
 * order: `data-flip-id` items glide to their new places, a removed one plays
 * `ghostClass`'s exit as a copy, and a new one animates by its own stylesheet.
 */
export class ListMotion extends Component<{
  ids: string[];
  container: RefObject<HTMLElement | null>;
  ghostClass: string;
  /** The longest the ghost's exit runs - a fallback, not a wait. */
  exitMs: number;
  ghostsUnder?: boolean;
}> {
  getSnapshotBeforeUpdate(previous: { ids: string[] }) {
    const { ids } = this.props;
    const container = this.props.container.current;
    const same =
      previous.ids.length === ids.length &&
      previous.ids.every((id, i) => id === ids[i]);
    if (!container || same || !motionAllowed()) return null;
    const items = container.querySelectorAll<HTMLElement>("[data-flip-id]");
    const ghosts: Ghost[] = [];
    for (const item of items) {
      const id = item.dataset.flipId!;
      if (previous.ids.includes(id) && !ids.includes(id))
        ghosts.push(captureGhost(item));
    }
    return { rects: measure(items), ghosts };
  }

  componentDidUpdate(
    _: unknown,
    __: unknown,
    snapshot: { rects: Snapshot; ghosts: Ghost[] } | null,
  ) {
    const container = this.props.container.current;
    if (!snapshot || !container) return;
    play(snapshot.rects);
    for (const ghost of snapshot.ghosts)
      releaseGhost(
        ghost,
        container,
        this.props.ghostClass,
        this.props.exitMs,
        this.props.ghostsUnder ?? true,
      );
  }

  render(): ReactNode {
    return null;
  }
}
