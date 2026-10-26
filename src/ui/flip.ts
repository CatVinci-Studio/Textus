import { Component, type ReactNode, type RefObject } from "react";
import {
  animate,
  motionAllowed,
  type DurationToken,
  type EasingToken,
} from "./motion";

/**
 * FLIP: moved list items slide from their old place to their new one on
 * transforms alone. `measure` in the event handler causing the change, then
 * `play` in a layout effect after React commits.
 */

export type Snapshot = Map<Element, DOMRect>;

const FLIP_ID = "flip";

/** Where each element is on screen now, any slide in flight included -
 *  so a second change mid-slide continues from where things are. */
export function measure(elements: Iterable<Element>): Snapshot {
  const rects: Snapshot = new Map();
  for (const el of elements) rects.set(el, el.getBoundingClientRect());
  return rects;
}

type Timing = { duration?: DurationToken | number; easing?: EasingToken };

/** Slides every element of `before` that moved from its old place to its new
 *  one. `timingFor` gives one element its own timing. */
export function play(
  before: Snapshot,
  {
    duration = "--dur-base",
    easing = "--ease-in-out",
    timingFor,
  }: Timing & { timingFor?: (el: Element) => Timing | undefined } = {},
): void {
  if (!motionAllowed()) return;
  const targets = [...before.keys()].filter((el) => el.isConnected);
  // Slides still running were measured into `before`; they must not count
  // again in the new positions.
  for (const el of targets)
    for (const running of el.getAnimations?.() ?? [])
      if (running.id === FLIP_ID) running.cancel();
  const moves: { el: Element; dx: number; dy: number }[] = [];
  for (const el of targets) {
    const was = before.get(el)!;
    const now = el.getBoundingClientRect();
    const dx = was.left - now.left;
    const dy = was.top - now.top;
    if (Math.abs(dx) >= 0.5 || Math.abs(dy) >= 0.5) moves.push({ el, dx, dy });
  }
  for (const { el, dx, dy } of moves) {
    const own = timingFor?.(el);
    animate(
      el,
      [{ transform: `translate(${dx}px, ${dy}px)` }, { transform: "none" }],
      {
        duration: own?.duration ?? duration,
        easing: own?.easing ?? easing,
        id: FLIP_ID,
      },
    );
  }
}

/** What a removed element looked like and where it sat, taken before the
 *  commit that removes it. */
export interface Ghost {
  node: HTMLElement;
  left: number;
  top: number;
  width: number;
  height: number;
}

/** A copy of `el` and its place in its offset parent, for an exit played
 *  after React has removed the original. */
export function captureGhost(el: HTMLElement): Ghost {
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
export function releaseGhost(
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
  const running = node.getAnimations?.() ?? [];
  if (running.length === 0) {
    node.remove();
    return;
  }
  const leave = () => node.remove();
  window.setTimeout(leave, exitMs + 50);
  void Promise.allSettled(running.map((a) => a.finished)).then(leave);
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
}> {
  getSnapshotBeforeUpdate(previous: { watch: unknown }): Snapshot | null {
    if (Object.is(previous.watch, this.props.watch) || !motionAllowed())
      return null;
    return measure(this.props.targets());
  }

  componentDidUpdate(_: unknown, __: unknown, before: Snapshot | null) {
    if (!before) return;
    // After the commit's other layout effects (a parent's may be what moves the
    // layout), but before the frame is painted.
    const { duration, easing } = this.props;
    queueMicrotask(() => play(before, { duration, easing }));
  }

  render(): ReactNode {
    return null;
  }
}

/** What a gesture measured itself mid-move, for ListMotion to start from:
 *  places before it cleared its shifts, the item let go of, and one that left
 *  with the pointer. */
export interface PendingFlip {
  rects: Snapshot;
  dropped?: string;
  gone?: string;
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
  pending?: RefObject<PendingFlip | null>;
}> {
  getSnapshotBeforeUpdate(previous: { ids: string[] }) {
    const pending = this.props.pending?.current ?? null;
    if (this.props.pending) this.props.pending.current = null;
    const { ids } = this.props;
    const container = this.props.container.current;
    const same =
      previous.ids.length === ids.length &&
      previous.ids.every((id, i) => id === ids[i]);
    if (!container || (same && !pending) || !motionAllowed()) return null;
    const items = container.querySelectorAll<HTMLElement>("[data-flip-id]");
    const ghosts: Ghost[] = [];
    for (const item of items) {
      const id = item.dataset.flipId!;
      if (
        previous.ids.includes(id) &&
        !ids.includes(id) &&
        id !== pending?.gone
      )
        ghosts.push(captureGhost(item));
    }
    return {
      rects: pending?.rects ?? measure(items),
      dropped: pending?.dropped,
      ghosts,
    };
  }

  componentDidUpdate(
    _: unknown,
    __: unknown,
    snapshot: { rects: Snapshot; dropped?: string; ghosts: Ghost[] } | null,
  ) {
    const container = this.props.container.current;
    if (!snapshot || !container) return;
    play(snapshot.rects, {
      timingFor: (el) =>
        el instanceof HTMLElement && el.dataset.flipId === snapshot.dropped
          ? { duration: "--dur-medium", easing: "--ease-spring-bouncy" }
          : undefined,
    });
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
