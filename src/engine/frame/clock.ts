import { duration, motionAllowed } from "../motion/motion";
import { easingFn } from "./easing";
import { between, sameRect, type Rect } from "./rect";

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

export class FrameClock {
  private elements = new Map<string, HTMLElement>();
  private groups = new Map<string, Group>();
  /** Where each part is drawn now. */
  private shown = new Map<string, Rect>();
  private runs = new Map<string, Run>();
  private frame = 0;
  private ease = easingFn("--ease-settle");

  attach(key: string, el: HTMLElement | null): void {
    if (el) this.elements.set(key, el);
    else this.elements.delete(key);
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
    this.groups.set(name, { parts, origin });
    for (const key of was?.parts.keys() ?? [])
      if (!parts.has(key)) {
        this.shown.delete(key);
        this.runs.delete(key);
      }
    const moving = animate && motionAllowed();
    for (const [key, part] of parts) {
      // Already on its way there: it keeps going, not started over.
      const running = this.runs.get(key);
      if (moving && running && sameRect(running.to, part.rect)) continue;
      const from = this.shown.get(key) ?? (moving ? grown(part) : part.rect);
      if (moving && !sameRect(from, part.rect))
        this.runs.set(key, { from, to: part.rect, start: null });
      else {
        this.runs.delete(key);
        this.shown.set(key, part.rect);
      }
    }
    this.paint(null);
    if (this.runs.size && !this.frame)
      this.frame = requestAnimationFrame((t) => this.tick(t));
  }

  /** Group `name` gone with its container. */
  drop(name: string): void {
    for (const key of this.groups.get(name)?.parts.keys() ?? []) {
      this.shown.delete(key);
      this.runs.delete(key);
    }
    this.groups.delete(name);
  }

  /** Part `key` drawn at `rect` now, from where a gesture left it (a tab
   *  let go mid-drag); the next `set` moves it on from there. */
  place(key: string, rect: Rect): void {
    this.runs.delete(key);
    this.shown.set(key, rect);
    for (const group of this.groups.values()) {
      const part = group.parts.get(key);
      if (part) this.write(key, part, group.origin);
    }
  }

  /** Where part `key` is drawn now, if placed. */
  rectOf(key: string): Rect | undefined {
    return this.shown.get(key);
  }

  /** Where part `key` ends up, once any slide is over. */
  targetOf(key: string): Rect | undefined {
    for (const group of this.groups.values()) {
      const part = group.parts.get(key);
      if (part) return part.rect;
    }
    return undefined;
  }

  private tick(now: number) {
    this.frame = 0;
    this.paint(now);
    if (this.runs.size) this.frame = requestAnimationFrame((t) => this.tick(t));
  }

  /** `now` null: the changes' first frame, drawn before the page paints. */
  private paint(now: number | null) {
    const span = duration(SETTLE);
    for (const [key, run] of this.runs) {
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
    for (const group of this.groups.values())
      for (const [key, part] of group.parts)
        this.write(key, part, group.origin);
  }

  private write(
    key: string,
    part: FramePart,
    origin: { x: number; y: number },
  ) {
    const el = this.elements.get(key);
    const at = this.shown.get(key);
    if (!el || !at) return;
    const s = el.style;
    if (part.along) {
      s.left = `${at.x - origin.x}px`;
      s.width = `${at.w}px`;
      return;
    }
    if (!part.follow) {
      s.left = `${at.x - origin.x}px`;
      s.top = `${at.y - origin.y}px`;
      s.width = `${at.w}px`;
      s.height = `${at.h}px`;
      return;
    }
    const end = part.rect;
    if (!part.own) {
      s.left = `${end.x - origin.x}px`;
      s.top = `${end.y - origin.y}px`;
      s.width = `${end.w}px`;
      s.height = `${end.h}px`;
    }
    const on = this.shown.get(part.follow) ?? end;
    const box = part.above
      ? { x: on.x, y: on.y - end.h, w: on.w, h: end.h }
      : on;
    const settled = sameRect(box, end);
    const dx = part.still ? 0 : box.x - end.x;
    const dy = part.still ? 0 : box.y - end.y;
    s.transform = settled || (!dx && !dy) ? "" : `translate(${dx}px, ${dy}px)`;
    // Clipped to the box it lies on, wherever that box now is.
    const left = Math.max(0, box.x - (end.x + dx));
    const top = Math.max(0, box.y - (end.y + dy));
    const right = Math.max(0, end.x + dx + end.w - (box.x + box.w));
    const bottom = Math.max(0, end.y + dy + end.h - (box.y + box.h));
    s.clipPath =
      settled || !(left || top || right || bottom)
        ? ""
        : `inset(${top}px ${right}px ${bottom}px ${left}px)`;
  }
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
