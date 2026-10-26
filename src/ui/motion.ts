/**
 * Timing for motion CSS can't express on its own (FLIP, the AI sheet under a
 * finger, smooth scrolling), from the same tokens and switches as motion.css.
 * Everything degrades to no movement.
 */

export type DurationToken =
  | "--dur-instant"
  | "--dur-fast"
  | "--dur-base"
  | "--dur-medium"
  | "--dur-slow"
  | "--dur-sheet"
  | "--dur-linger"
  | "--dur-stagger"
  | "--dur-cascade";

export type EasingToken =
  | "--ease-standard"
  | "--ease-out"
  | "--ease-in"
  | "--ease-in-out"
  | "--ease-spring"
  | "--ease-spring-bouncy";

const REDUCE_QUERY = "(prefers-reduced-motion: reduce)";

/** The defaults in motion.css, for when the stylesheet can't be read. */
const DURATIONS: Record<DurationToken, number> = {
  "--dur-instant": 80,
  "--dur-fast": 120,
  "--dur-base": 200,
  "--dur-medium": 250,
  "--dur-slow": 320,
  "--dur-sheet": 450,
  "--dur-linger": 1600,
  "--dur-stagger": 18,
  "--dur-cascade": 700,
};

/** The cubic fallbacks an engine without linear() runs. */
const CUBIC: Record<EasingToken, string> = {
  "--ease-standard": "cubic-bezier(0.25, 0.1, 0.25, 1)",
  "--ease-out": "cubic-bezier(0.16, 1, 0.3, 1)",
  "--ease-in": "cubic-bezier(0.4, 0, 1, 1)",
  "--ease-in-out": "cubic-bezier(0.45, 0, 0.25, 1)",
  "--ease-spring": "cubic-bezier(0.16, 1, 0.3, 1)",
  "--ease-spring-bouncy": "cubic-bezier(0.34, 1.3, 0.64, 1)",
};

/** Whether the system asks for reduced motion. Read live: the setting can
 *  change while the app is open. */
export function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia(REDUCE_QUERY).matches
  );
}

let probe: HTMLElement | null = null;

/** What the stylesheets say, read once and kept until a stylesheet in the
 *  head changes or reduced motion switches. Reading per animation forced a
 *  style recalculation every frame of a streaming rewrite. */
let sheet: { disabled: boolean; tokens: Map<string, string> } | null = null;
let watching = false;

function readSheet() {
  if (sheet) return sheet;
  if (!watching && typeof MutationObserver === "function") {
    watching = true;
    const forget = () => {
      sheet = null;
    };
    new MutationObserver(forget).observe(document.head, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
    });
    if (typeof window.matchMedia === "function")
      window.matchMedia(REDUCE_QUERY).addEventListener?.("change", forget);
  }
  sheet = { disabled: probeDisabled(), tokens: new Map() };
  return sheet;
}

/** True where a stylesheet has switched CSS animation off wholesale (the e2e
 *  helpers), read through an element whose own rule animates. Script-driven
 *  movement stands still there too. jsdom counts as off. */
function probeDisabled(): boolean {
  if (!probe || !probe.isConnected) {
    probe = document.createElement("div");
    probe.className = "motion-probe";
    probe.setAttribute("aria-hidden", "true");
    document.body.appendChild(probe);
  }
  const name = getComputedStyle(probe).animationName;
  return !name || name === "none";
}

function stylesheetDisablesAnimation(): boolean {
  if (typeof document === "undefined" || !document.body) return true;
  return readSheet().disabled;
}

let allowed: boolean | null = null;

/** Whether script-driven movement may run at all. Answered once per task, as
 *  a FLIP asks for every element it moves. */
export function motionAllowed(): boolean {
  if (allowed === null) {
    allowed = !prefersReducedMotion() && !stylesheetDisablesAnimation();
    queueMicrotask(() => {
      allowed = null;
    });
  }
  return allowed;
}

function readToken(name: string): string {
  if (typeof document === "undefined" || !document.body) return "";
  const { tokens } = readSheet();
  let value = tokens.get(name);
  if (value === undefined) {
    value = getComputedStyle(document.documentElement)
      .getPropertyValue(name)
      .trim();
    tokens.set(name, value);
  }
  return value;
}

/** A duration token in milliseconds, as the stylesheet currently has it
 *  (reduced motion shortens the slow ones). */
export function duration(token: DurationToken): number {
  const raw = readToken(token);
  const value = parseFloat(raw);
  if (!Number.isFinite(value)) return DURATIONS[token];
  return raw.endsWith("ms") ? value : value * 1000;
}

/** A length token in pixels, as the stylesheet currently has it (reduced
 *  motion sets the distances to 0): --motion-distance-sm / -md. */
export function length(
  token: "--motion-distance-sm" | "--motion-distance-md",
): number {
  const value = parseFloat(readToken(token));
  if (Number.isFinite(value)) return value;
  return token === "--motion-distance-sm" ? 4 : 8;
}

/** An easing token's current value: the linear() spring where the engine
 *  has it, else its cubic-bezier. */
export function easing(token: EasingToken): string {
  return readToken(token) || CUBIC[token];
}

/** `el.animate`, with the easing named by token. Safari before 17.2 throws on
 *  linear(), so that retries with the cubic fallback. Null where nothing
 *  should move or there is no Web Animations API. */
export function animate(
  el: Element,
  keyframes: Keyframe[],
  options: {
    duration: DurationToken | number;
    easing: EasingToken;
    delay?: number;
    fill?: FillMode;
    id?: string;
  },
): Animation | null {
  if (typeof el.animate !== "function" || !motionAllowed()) return null;
  const timing: KeyframeAnimationOptions = {
    duration:
      typeof options.duration === "number"
        ? options.duration
        : duration(options.duration),
    easing: easing(options.easing),
    delay: options.delay,
    fill: options.fill,
    id: options.id,
  };
  try {
    return el.animate(keyframes, timing);
  } catch {
    try {
      return el.animate(keyframes, {
        ...timing,
        easing: CUBIC[options.easing],
      });
    } catch {
      return null;
    }
  }
}

const gliding = new WeakMap<Element, () => void>();

/** Scrolls `el` by `delta` in one eased stroke of fixed length, however far,
 *  unlike native smooth scroll. A wheel or press on the way hands the scroll
 *  back; under reduced motion it jumps. */
export function glideScroll(
  el: HTMLElement,
  delta: number,
  token: DurationToken = "--dur-sheet",
) {
  gliding.get(el)?.();
  if (!motionAllowed() || Math.abs(delta) < 2) {
    el.scrollTop += delta;
    return;
  }
  const from = el.scrollTop;
  const length = duration(token);
  const start = performance.now();
  let frame = 0;
  const stop = () => {
    cancelAnimationFrame(frame);
    el.removeEventListener("wheel", stop);
    el.removeEventListener("pointerdown", stop);
    gliding.delete(el);
  };
  const step = (now: number) => {
    const t = Math.min(1, (now - start) / length);
    el.scrollTop = from + delta * (1 - Math.pow(1 - t, 4));
    if (t < 1) frame = requestAnimationFrame(step);
    else stop();
  };
  el.addEventListener("wheel", stop, { passive: true });
  el.addEventListener("pointerdown", stop);
  gliding.set(el, stop);
  frame = requestAnimationFrame(step);
}

/** "smooth" unless motion is reduced - for scrollIntoView and scrollTo. */
export function scrollBehavior(): ScrollBehavior {
  return motionAllowed() ? "smooth" : "auto";
}
