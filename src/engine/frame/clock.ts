import { duration, motionAllowed } from "../motion/motion";
import { easingFn } from "./easing";
import { between, sameRect, type Rect } from "./rect";
import { createSubscribers } from "../../utils/store";

/**
 * The window's one clock for where things are (design-language.md 5.7):
 * every part the layout places - a sidebar, an island's row and sheet, a
 * tab's view - moves from where it is to where the solver puts it on the
 * same frames, by the same numbers. Rects are in the shell's coordinates;
 * each group is written relative to its own container.
 *
 * A box (a row, a sheet: no text to reflow) takes its rect each frame. A
 * view keeps its final size and follows the box it lies on, clipped to it,
 * so nothing inside is laid out again while it moves.
 *
 * Each frame writes only what moved - the parts running and what lies on
 * them - and never a value an element already holds: a style write, even
 * of the same value, can cost the engine a style pass over what it holds.
 */

export type Edge = "left" | "right" | "top" | "bottom";

export interface FramePart {
  rect: Rect;
  /** A view on the box `follow`; without it, a box. */
  follow?: string;
  /** A view that is revealed where it is rather than carried along. */
  still?: boolean;
  /** A view its own stylesheet places (the sidebar, sized by its edge's
   *  drag): only clipped. */
  own?: boolean;
  /** A view standing just above the box it follows (an island's row of
   *  tabs over its sheet), clipped to the box's sides. */
  above?: boolean;
  /** New to the window: grows in from this edge of its place. */
  grows?: Edge;
  /** A box placed along its row only (a tab in its strip): its height and
   *  top stay its stylesheet's. */
  along?: boolean;
}

interface Run {
  from: Rect;
  to: Rect;
  /** Set on the first frame drawn: a change whose first frame comes late
   *  (a tab's content loading) still starts from its beginning. */
  start: number | null;
}

interface Group {
  parts: Map<string, FramePart>;
  origin: { x: number; y: number };
}

const SETTLE = "--dur-settle";

class FrameClock {
  private elements = new Map<string, HTMLElement>();
  private groups = new Map<string, Group>();
  /** Where each part is drawn now. */
  private shown = new Map<string, Rect>();
  private runs = new Map<string, Run>();
  private frame = 0;
  private ease = easingFn("--ease-settle");
  /** Whether a run was going after the last paint: its end is told. */
  private ran = false;
  private settled = createSubscribers();

  /** Whether anything is on its way now. What only measures the page
   *  (where lazy blocks fall) waits: the views are at their end size from
   *  the first frame, clipped, so a measure mid-motion buys nothing. */
  moving(): boolean {
    return this.runs.size > 0;
  }

  /** Calls `listener` each time the last run ends; returns the function
   *  that stops. */
  onSettled(listener: () => void): () => void {
    return this.settled.subscribe(listener);
  }

  attach(key: string, el: HTMLElement | null): void {
    if (!el) {
      // Let go (a sidebar turned a phone's): no carry or clip left on it
      // that nothing will write again.
      const had = this.elements.get(key);
      if (had) {
        had.style.transform = "";
        had.style.clipPath = "";
      }
      this.elements.delete(key);
      return;
    }
    const had = this.elements.get(key);
    this.elements.set(key, el);
    // A new element for a part already placed: drawn where it is at once.
    if (had !== el) this.writeKey(key);
  }

  /** The group's parts as they now should be; `animate` false puts them
   *  there at once (a window resized, a divider dragged). */
  set(
    name: string,
    parts: Map<string, FramePart>,
    origin: { x: number; y: number },
    animate: boolean,
  ): void {
    const was = this.groups.get(name);
    // The same places again, every part already drawn there (a render that
    // moved nothing): nothing to write. One a gesture left elsewhere (a tab
    // let go where it started) still goes home.
    if (was && same(was, parts, origin) && this.allAt(parts)) {
      this.groups.set(name, { parts, origin });
      return;
    }
    this.groups.set(name, { parts, origin });
    for (const key of was?.parts.keys() ?? [])
      if (!parts.has(key)) {
        this.shown.delete(key);
        this.runs.delete(key);
      }
    const moving = animate && motionAllowed();
    // The curve as the tokens say now (a theme, reduced motion).
    if (moving) this.ease = easingFn("--ease-settle");
    // Parts given a new place (their end, or drawn at once somewhere new):
    // laid out again. The rest keep what they hold.
    const placed = new Set<string>();
    for (const [key, part] of parts) {
      const before = was?.parts.get(key);
      if (!before || !samePart(before, part)) placed.add(key);
      // Already on its way there: it keeps going, not started over.
      const running = this.runs.get(key);
      if (moving && running && sameRect(running.to, part.rect)) continue;
      const shown = this.shown.get(key);
      const from = shown ?? (moving ? grown(part) : part.rect);
      if (moving && !sameRect(from, part.rect))
        this.runs.set(key, { from, to: part.rect, start: null });
      else {
        if (running || !shown || !sameRect(shown, part.rect)) placed.add(key);
        this.runs.delete(key);
        this.shown.set(key, part.rect);
      }
    }
    this.paint(null, placed);
    if (this.runs.size && !this.frame)
      this.frame = requestAnimationFrame((t) => this.tick(t));
    this.tell();
  }

  /** The runs' end told once, however they ended: run out, or put at
   *  their end at once, or their group gone. */
  private tell() {
    const ran = this.ran;
    this.ran = this.runs.size > 0;
    if (ran && !this.ran) this.settled.publish();
  }

  private allAt(parts: Map<string, FramePart>): boolean {
    for (const [key, part] of parts) {
      if (this.runs.has(key)) return false;
      const at = this.shown.get(key);
      if (at && !sameRect(at, part.rect)) return false;
    }
    return true;
  }

  /** Group `name` gone with its container. */
  drop(name: string): void {
    for (const key of this.groups.get(name)?.parts.keys() ?? []) {
      this.shown.delete(key);
      this.runs.delete(key);
    }
    this.groups.delete(name);
    this.tell();
  }

  /** Part `key` drawn at `rect` now, from where a gesture left it (a tab
   *  let go mid-drag); the next `set` moves it on from there. */
  place(key: string, rect: Rect): void {
    this.runs.delete(key);
    this.shown.set(key, rect);
    this.writeKey(key);
    this.tell();
  }

  /** Part `key` written in full wherever a group holds it. */
  private writeKey(key: string) {
    for (const group of this.groups.values()) {
      const part = group.parts.get(key);
      if (part) this.write(key, part, group.origin, true);
    }
  }

  private tick(now: number) {
    this.frame = 0;
    this.paint(now, new Set());
    if (this.runs.size) this.frame = requestAnimationFrame((t) => this.tick(t));
    this.tell();
  }

  /** `now` null: the changes' first frame, drawn before the page paints.
   *  `placed`: the parts `set` gave a new place, written in full; the parts
   *  running move, and what lies on a part that moved follows it. */
  private paint(now: number | null, placed: Set<string>) {
    const span = duration(SETTLE);
    const moved = new Set(placed);
    for (const [key, run] of this.runs) {
      moved.add(key);
      if (now !== null) run.start ??= now;
      const t =
        now === null || run.start === null
          ? 0
          : Math.min(1, (now - run.start) / span);
      this.shown.set(
        key,
        t >= 1 ? run.to : between(run.from, run.to, this.ease(t)),
      );
      if (t >= 1) this.runs.delete(key);
    }
    if (!moved.size) return;
    for (const group of this.groups.values())
      for (const [key, part] of group.parts)
        if (moved.has(key) || (part.follow && moved.has(part.follow)))
          this.write(key, part, group.origin, placed.has(key));
  }

  /** `placed`: a view's end rect written too (it changes only with `set`,
   *  `place` or a new element; React's render holds the same). */
  private write(
    key: string,
    part: FramePart,
    origin: { x: number; y: number },
    placed: boolean,
  ) {
    const el = this.elements.get(key);
    const at = this.shown.get(key);
    if (!el || !at) return;
    const s = el.style;
    if (part.along) {
      put(s, "left", `${at.x - origin.x}px`);
      put(s, "width", `${at.w}px`);
      return;
    }
    if (!part.follow) {
      put(s, "left", `${at.x - origin.x}px`);
      put(s, "top", `${at.y - origin.y}px`);
      put(s, "width", `${at.w}px`);
      put(s, "height", `${at.h}px`);
      return;
    }
    const end = part.rect;
    if (!part.own && placed) {
      put(s, "left", `${end.x - origin.x}px`);
      put(s, "top", `${end.y - origin.y}px`);
      put(s, "width", `${end.w}px`);
      put(s, "height", `${end.h}px`);
    }
    const on = this.shown.get(part.follow) ?? end;
    const box = part.above
      ? { x: on.x, y: on.y - end.h, w: on.w, h: end.h }
      : on;
    const settled = sameRect(box, end);
    const dx = part.still ? 0 : box.x - end.x;
    const dy = part.still ? 0 : box.y - end.y;
    put(
      s,
      "transform",
      settled || (!dx && !dy) ? "" : `translate(${dx}px, ${dy}px)`,
    );
    // Clipped to the box it lies on, wherever that box now is.
    const left = Math.max(0, box.x - (end.x + dx));
    const top = Math.max(0, box.y - (end.y + dy));
    const right = Math.max(0, end.x + dx + end.w - (box.x + box.w));
    const bottom = Math.max(0, end.y + dy + end.h - (box.y + box.h));
    put(
      s,
      "clipPath",
      settled || !(left || top || right || bottom)
        ? ""
        : `inset(${top}px ${right}px ${bottom}px ${left}px)`,
    );
  }
}

type Written = "left" | "top" | "width" | "height" | "transform" | "clipPath";

/** What the clock last wrote to each style, and what the engine held then:
 *  the engine may spell a value its own way (a long fraction cut short),
 *  and React may have written since. */
const written = new WeakMap<
  CSSStyleDeclaration,
  Map<Written, { wrote: string; held: string }>
>();

/** `s[prop] = value`, unless it holds that already. */
function put(s: CSSStyleDeclaration, prop: Written, value: string): void {
  let last = written.get(s);
  const was = last?.get(prop);
  const held = s[prop];
  if (held === value || (was && was.wrote === value && was.held === held))
    return;
  s[prop] = value;
  if (!last) written.set(s, (last = new Map()));
  last.set(prop, { wrote: value, held: s[prop] });
}

/** Whether `group` already holds `parts` at `origin`, every one alike. */
function same(
  group: Group,
  parts: Map<string, FramePart>,
  origin: { x: number; y: number },
): boolean {
  if (group.origin.x !== origin.x || group.origin.y !== origin.y) return false;
  if (group.parts.size !== parts.size) return false;
  for (const [key, part] of parts) {
    const was = group.parts.get(key);
    if (!was || !samePart(was, part)) return false;
  }
  return true;
}

/** The same place, held the same way. */
function samePart(a: FramePart, b: FramePart): boolean {
  return (
    sameRect(a.rect, b.rect) &&
    a.follow === b.follow &&
    a.still === b.still &&
    a.own === b.own &&
    a.above === b.above &&
    a.along === b.along
  );
}

/** A new part's first frame: none of it yet, at the edge it grows from. */
function grown(part: FramePart): Rect {
  const r = part.rect;
  switch (part.grows) {
    case "right":
      return { x: r.x + r.w, y: r.y, w: 0, h: r.h };
    case "left":
      return { x: r.x, y: r.y, w: 0, h: r.h };
    case "bottom":
      return { x: r.x, y: r.y + r.h, w: r.w, h: 0 };
    case "top":
      return { x: r.x, y: r.y, w: r.w, h: 0 };
    default:
      return r;
  }
}

/** The window's clock. */
export const frameClock = new FrameClock();
