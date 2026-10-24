import {
  animate,
  duration,
  length,
  motionAllowed,
  type DurationToken,
} from "./motion";
import { measure, play } from "./flip";

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

/**
 * Beats: the parts of one change - its new text in the document, its card
 * in the margin - enter as one, though each is drawn when its own code gets
 * to it (ProseMirror's widgets first, React's cards a frame or two later).
 * The first part to enter starts the beat, or the code that lands the
 * change starts it for all of them (`startBeat`); each part after joins it
 * as far in as it already is, so they all end together. Drawn on their own
 * moments, a card came in after its text and read as a second event.
 */
const beats = new Map<string, number>();

/** How long a beat is kept to be joined: well past any entrance. */
const BEAT_KEPT_MS = 3000;

function prune(now: number) {
  for (const [key, at] of beats) if (now - at > BEAT_KEPT_MS) beats.delete(key);
}

/** Starts `key`'s beat at `at` (now): the parts of a change landing
 *  together share it. */
export function startBeat(key: string, at = performance.now()) {
  prune(at);
  beats.set(key, at);
}

/** How far into `key`'s beat it is, in ms; null when it has none. */
export function beatElapsed(
  key: string,
  now = performance.now(),
): number | null {
  const at = beats.get(key);
  return at === undefined ? null : now - at;
}

/** `el` enters on `key`'s beat: from the start if it begins the beat,
 *  partway into the entrance if the beat has begun - and is just there
 *  once the entrance would be over. */
export function enterOnBeat(
  el: Element,
  key: string,
  options: MoveOptions = {},
): Animation | null {
  const now = performance.now();
  if (!beats.has(key)) startBeat(key, now);
  const into = beatElapsed(key, now) ?? 0;
  const total =
    typeof options.duration === "number"
      ? options.duration
      : duration(options.duration ?? "--dur-medium");
  if (into >= total + (options.delay ?? 0)) return null;
  return enter(el, { ...options, delay: (options.delay ?? 0) - into });
}

/** The same for an element whose stylesheet plays its entrance (a margin
 *  card's `motion-enter`): its animation set back by how far the beat is
 *  in. Without a beat it keeps its own entrance. */
export function joinBeat(el: HTMLElement, key: string) {
  const into = beatElapsed(key);
  if (into === null || !motionAllowed()) return;
  el.style.animationDelay = `${-Math.round(into)}ms`;
}

/**
 * A change to some blocks of `root` made in one go - a proposal accepted
 * or rejected - shown as one move: the blocks it touches (`touched`, the
 * first and the last of them) cross-fade from how they looked to how they
 * now look, the blocks after them glide to where the change put them, and
 * `leaving` (its cards in the margin) fade out where they stood. The old
 * looks are copies taken before `change` runs, which replaces the
 * elements; `change` runs at once and the motion follows, so nothing
 * waits on it. Changed at once, the text jumped, and the card was gone
 * from one frame to the next.
 */
export function crossfade(
  root: HTMLElement,
  touched: [first: Element, last: Element] | null,
  change: () => void,
  leaving: HTMLElement[] = [],
): void {
  if (!motionAllowed()) {
    change();
    return;
  }
  const kids = [...root.children];
  const first = touched ? kids.indexOf(touched[0]) : -1;
  const last = touched ? kids.indexOf(touched[1]) : -1;
  const span = first >= 0 && last >= first;
  const bottom = window.innerHeight;
  const onScreen = (el: Element) => {
    const r = el.getBoundingClientRect();
    return r.bottom > 0 && r.top < bottom;
  };
  const layer = span ? ghostLayer(root) : null;
  const ghosts = [
    ...(span && layer
      ? kids
          .slice(first, last + 1)
          .filter(onScreen)
          .map((el) => ghostIn(el as HTMLElement, layer, root))
      : []),
    ...leaving.filter(onScreen).map((el) => ghostBeside(el)),
  ];
  const below = measure(kids.slice(span ? last + 1 : 0).filter(onScreen));
  change();
  const now = [...root.children];
  const fresh = span
    ? now.slice(first, last + 1 + now.length - kids.length).filter(onScreen)
    : [];
  for (const el of fresh)
    animate(el, [{ opacity: 0 }, { opacity: 1 }], {
      duration: "--dur-base",
      easing: "--ease-out",
    });
  for (const ghost of ghosts)
    void exit(ghost, { from: "none", duration: "--dur-base" }).then(() =>
      ghost.remove(),
    );
  if (layer)
    window.setTimeout(() => layer.remove(), duration("--dur-base") + 100);
  play(below, { duration: "--dur-slow", easing: "--ease-out" });
}

/** A copy fading out (motion.css): none of its own entrances replay. */
export const GHOST_CLASS = "motion-ghost";

/** Where the copies of `root`'s blocks are laid while they fade: an empty
 *  copy of `root` itself beside it, out of its DOM (ProseMirror reads any
 *  change in its own as an edit) yet styled as it is - its classes and
 *  attributes, under the same ancestors. */
function ghostLayer(root: HTMLElement): HTMLElement | null {
  const parent = root.parentElement;
  if (!parent) return null;
  const layer = root.cloneNode(false) as HTMLElement;
  layer.removeAttribute("contenteditable");
  layer.removeAttribute("id");
  layer.removeAttribute("role");
  layer.setAttribute("aria-hidden", "true");
  layer.classList.add(GHOST_CLASS);
  layer.inert = true;
  Object.assign(layer.style, {
    position: "absolute",
    left: `${root.offsetLeft}px`,
    top: `${root.offsetTop}px`,
    width: `${root.offsetWidth}px`,
    height: "0",
    minHeight: "0",
    margin: "0",
    pointerEvents: "none",
  });
  parent.append(layer);
  return layer;
}

function ghostIn(el: HTMLElement, layer: HTMLElement, root: HTMLElement) {
  const ghost = el.cloneNode(true) as HTMLElement;
  Object.assign(ghost.style, {
    position: "absolute",
    left: `${el.offsetLeft - root.offsetLeft}px`,
    top: `${el.offsetTop - root.offsetTop}px`,
    width: `${el.offsetWidth}px`,
    margin: "0",
  });
  layer.append(ghost);
  return ghost;
}

/** A copy of an absolutely placed element (a margin card) where it stands,
 *  for it to fade out after the element itself has gone. */
function ghostBeside(el: HTMLElement) {
  const ghost = el.cloneNode(true) as HTMLElement;
  ghost.setAttribute("aria-hidden", "true");
  ghost.removeAttribute("id");
  ghost.classList.add(GHOST_CLASS);
  ghost.inert = true;
  ghost.style.pointerEvents = "none";
  el.after(ghost);
  return ghost;
}

/**
 * What comes after `el` in `root` - the parts below a part that just grew
 * by `by` px, or arrived - glides down from where it stood to where it now
 * is (FLIP): written into the middle of a document, each block that landed
 * pushed the text below it down at once. Only what is on screen moves.
 */
export function glideAfter(el: Element, by: number, root: Element) {
  if (!motionAllowed() || by < 1) return;
  let block: Element | null = el;
  while (block && block.parentElement !== root) block = block.parentElement;
  if (!block) return;
  const bottom = window.innerHeight;
  for (
    let next = block.nextElementSibling;
    next && next.getBoundingClientRect().top - by < bottom;
    next = next.nextElementSibling
  )
    animate(
      next,
      [{ transform: `translateY(${-by}px)` }, { transform: "none" }],
      { duration: "--dur-medium", easing: "--ease-out" },
    );
}
