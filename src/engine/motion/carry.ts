/**
 * A surface's look carried across a reversal: closed while its entrance is
 * still running, its exit starts from where the entrance had got to, and
 * opened again while its exit runs, its entrance starts from where the exit
 * had got to. A keyframe move otherwise begins from its own first frame - the
 * full surface, or nothing - and the surface flashes there for a frame.
 */

/** Where an element sits in the surface: child indexes from its root. */
type Path = readonly number[];

/** How opaque each moving part of a surface is now. */
export type Look = readonly (readonly [Path, number])[];

/** Below this, two opacities read as the same. */
const SAME = 0.04;

/** Steps of the search for the matching moment: a frame's precision on the
 *  longest exit. */
const STEPS = 10;

/** A stylesheet's: a transition already starts from where it is, and a
 *  script's moves keep their own timing. */
function isCssAnimation(animation: Animation): boolean {
  return (
    typeof (animation as { animationName?: unknown }).animationName === "string"
  );
}

/** The stylesheet animations running on `el` itself (not its children), with
 *  an end: loops never need carrying. */
function moving(el: Element): Animation[] {
  return (el.getAnimations?.() ?? []).filter((animation) => {
    if (!isCssAnimation(animation) || animation.playState !== "running")
      return false;
    // A ::before's opacity is not the element's, which is what is read.
    if ((animation.effect as KeyframeEffect | null)?.pseudoElement)
      return false;
    const end = animation.effect?.getComputedTiming().endTime;
    return typeof end === "number" && Number.isFinite(end) && end > 0;
  });
}

function pathOf(root: Element, el: Element): Path | null {
  const path: number[] = [];
  for (let at = el; at !== root;) {
    const parent = at.parentElement;
    if (!parent) return null;
    path.unshift(Array.prototype.indexOf.call(parent.children, at));
    at = parent;
  }
  return path;
}

function atPath(root: Element, path: Path): Element | null {
  let at: Element | undefined = root;
  for (const i of path) at = at?.children[i];
  return at ?? null;
}

const opacityOf = (el: Element) => parseFloat(getComputedStyle(el).opacity);

/** The opacity of every part of `root` caught mid-move: nothing when none
 *  is, so a surface at rest carries nothing. */
export function readLook(root: Element | null): Look {
  if (!root?.isConnected || typeof root.getAnimations !== "function") return [];
  const parts = new Set<Element>();
  for (const animation of root.getAnimations({ subtree: true })) {
    const target = (animation.effect as KeyframeEffect | null)?.target;
    if (target && moving(target).includes(animation)) parts.add(target);
  }
  const look: [Path, number][] = [];
  for (const part of parts) {
    const path = pathOf(root, part);
    if (path) look.push([path, opacityOf(part)]);
  }
  return look;
}

/** Moves each new animation on `el` to the moment it shows `opacity`, found
 *  by halving: an entrance or an exit only ever brightens or fades. One that
 *  never reaches it (it doesn't fade) is left as it is. */
function seek(el: Element, opacity: number): void {
  for (const animation of moving(el)) {
    const end = animation.effect!.getComputedTiming().endTime as number;
    const at = (time: number) => {
      animation.currentTime = time;
      return opacityOf(el);
    };
    const start = at(0);
    const last = at(end - 1);
    const fading = last < start;
    if (
      Math.abs(start - opacity) < SAME ||
      opacity < Math.min(start, last) - SAME ||
      opacity > Math.max(start, last) + SAME
    ) {
      animation.currentTime = 0;
      continue;
    }
    let low = 0;
    let high = end - 1;
    for (let i = 0; i < STEPS; i++) {
      const mid = (low + high) / 2;
      const shown = at(mid);
      if (fading ? shown > opacity : shown < opacity) low = mid;
      else high = mid;
    }
    animation.currentTime = (low + high) / 2;
  }
}

/** Starts the moves `root` has just been given from `look`, part by part. */
export function carryLook(root: Element | null, look: Look): void {
  if (!root?.isConnected || look.length === 0) return;
  for (const [path, opacity] of look) {
    const part = atPath(root, path);
    if (part) seek(part, opacity);
  }
}
