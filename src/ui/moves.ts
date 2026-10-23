import {
  animate,
  duration,
  length,
  motionAllowed,
  type DurationToken,
} from "./motion";

/**
 * The few moves everything in Textus is made of (docs/design/design-language.md, Motion), for
 * script that starts them - an element drawn by the editor, a proposal
 * landing. A stylesheet entrance (`animation: motion-enter …`, motion.css)
 * is the same move for an element that mounts.
 *
 * - enter: a part of the page arrives, fading in from a short way off;
 * - exit: it leaves the same way;
 * - mark: what is about to change is tinted for a moment, then the change
 *   comes (`land`);
 * - glide (flip.ts) and presence (usePresence.ts): moving to a new place,
 *   and staying in the DOM while an exit plays.
 *
 * Only opacity and transform ever animate; a tint is set and taken off,
 * never faded. Each move runs where motionAllowed() says so and otherwise
 * ends at once in its final state.
 */

/** Where an element comes from or goes to: a short way below ("up": it
 *  rises into place), above, before or after it in the line, or nowhere
 *  (a fade in place). "start" and "end" follow the writing direction. */
export type Direction = "none" | "up" | "down" | "start" | "end";

/** How far it travels: motion.css's --motion-distance-sm / -md. */
export type Distance = "sm" | "md";

export interface MoveOptions {
  from?: Direction;
  distance?: Distance;
  /** A scale to grow from (enter) or shrink to (exit), e.g. 0.96. */
  scale?: number;
  duration?: DurationToken | number;
  delay?: number;
}

function offset(el: Element, from: Direction, distance: Distance): string {
  const d = length(`--motion-distance-${distance}`);
  const rtl = getComputedStyle(el).direction === "rtl";
  switch (from) {
    case "up":
      return `translateY(${d}px)`;
    case "down":
      return `translateY(${-d}px)`;
    case "start":
      return `translateX(${rtl ? d : -d}px)`;
    case "end":
      return `translateX(${rtl ? -d : d}px)`;
    default:
      return "none";
  }
}

function transformOf(
  el: Element,
  { from = "up", distance = "sm", scale }: MoveOptions,
): string {
  const parts = [offset(el, from, distance), scale ? `scale(${scale})` : ""]
    .filter((p) => p && p !== "none")
    .join(" ");
  return parts || "none";
}

/** `el` arrives: from transparent and a short way off to where it is. */
export function enter(
  el: Element,
  options: MoveOptions = {},
): Animation | null {
  return animate(
    el,
    [
      { opacity: 0, transform: transformOf(el, options) },
      { opacity: 1, transform: "none" },
    ],
    {
      duration: options.duration ?? "--dur-medium",
      easing: "--ease-out",
      delay: options.delay,
      fill: "backwards",
    },
  );
}

/** `el` leaves the way it came; resolves when it has (at once where
 *  nothing moves), for the caller to take it out. */
export function exit(el: Element, options: MoveOptions = {}): Promise<void> {
  const running = animate(
    el,
    [
      { opacity: 1, transform: "none" },
      { opacity: 0, transform: transformOf(el, options) },
    ],
    {
      duration: options.duration ?? "--dur-fast",
      easing: "--ease-in",
      delay: options.delay,
      fill: "forwards",
    },
  );
  return running
    ? running.finished.then(
        () => undefined,
        () => undefined,
      )
    : Promise.resolve();
}

/** The class a mark puts on what is about to change (motion.css). */
export const MARK_CLASS = "motion-mark";

/** How long a mark stays before the change comes. */
export function markTime(): number {
  return motionAllowed() ? duration("--dur-slow") : 0;
}

/**
 * The two beats of a change landing: what it changes is marked for a
 * moment (each of `marked`), then `change` runs and what it brought
 * (`entering`, from its return) enters. With nothing to mark - new text
 * with no original - the change comes at once. `skipMark` lands it at
 * once too, for a backlog catching up. Resolves once it has landed.
 */
export async function land(
  marked: Element[],
  change: () => Element[] | void,
  { skipMark = false, ...move }: MoveOptions & { skipMark?: boolean } = {},
): Promise<void> {
  const wait = skipMark || !marked.length ? 0 : markTime();
  if (wait) {
    for (const el of marked) el.classList.add(MARK_CLASS);
    await new Promise((resolve) => setTimeout(resolve, wait));
    for (const el of marked) el.classList.remove(MARK_CLASS);
  }
  const entering = change() ?? [];
  for (const el of entering) enter(el, { from: "none", ...move });
}
