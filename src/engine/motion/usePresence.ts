import {
  Fragment,
  createContext,
  createElement,
  useCallback,
  useContext,
  useLayoutEffect,
  useRef,
  useState,
  type ComponentProps,
  type ReactNode,
  type Ref,
} from "react";

/**
 * Exits: a surface stays mounted a little after it closes, marked
 * data-state="closing" and `inert`, so its stylesheet can play it out.
 * Entrances need nothing from here. Nothing ever waits for the exit.
 */

export type PresenceState = "open" | "closing";

export interface PresenceHandle {
  /** In the DOM: open, or on its way out. */
  mounted: boolean;
  state: PresenceState;
  /** For the element whose exit decides when it leaves. */
  ref: (el: Element | null) => void;
}

/** The finite animations running in the element and its subtree; loops are
 *  left out. Null without the Web Animations API. */
function runningExit(el: Element): Animation[] | null {
  if (typeof el.getAnimations !== "function") return null;
  return el.getAnimations({ subtree: true }).filter((animation) => {
    if (animation.playState !== "running") return false;
    const end = animation.effect?.getComputedTiming().endTime;
    return typeof end === "number" && Number.isFinite(end);
  });
}

function hasExit(el: Element): boolean {
  const running = runningExit(el);
  if (running) return running.length > 0;
  const style = getComputedStyle(el);
  const animated = (style.animationName || "")
    .split(",")
    .some((name) => name.trim() !== "" && name.trim() !== "none");
  const transitioned = (style.transitionDuration || "")
    .split(",")
    .some((time) => parseFloat(time) > 0);
  return animated || transitioned;
}

/** `open` as it should be on screen: on close it stays mounted, "closing",
 *  until its exit animations end, `exitMs` passes, or at once when none runs. */
export function usePresence(
  open: boolean,
  { exitMs = 200 }: { exitMs?: number } = {},
): PresenceHandle {
  const [mounted, setMounted] = useState(open);
  const [closing, setClosing] = useState(false);
  // Adjusted while rendering rather than in an effect, so the frame that
  // shows the change is the first one painted.
  if (open && (!mounted || closing)) {
    setMounted(true);
    setClosing(false);
  } else if (!open && mounted && !closing) {
    setClosing(true);
  }

  const element = useRef<Element | null>(null);
  const ref = useCallback((el: Element | null) => {
    element.current = el;
  }, []);

  useLayoutEffect(() => {
    if (!closing) return;
    let alive = true;
    const finish = () => {
      if (!alive) return;
      alive = false;
      setMounted(false);
      setClosing(false);
    };
    const el = element.current;
    if (!el || !el.isConnected || !hasExit(el)) {
      finish();
      return;
    }
    const timer = window.setTimeout(finish, exitMs + 50);
    const running = runningExit(el);
    const onEnd = (event: Event) => {
      if (event.target === el) finish();
    };
    if (running) {
      void Promise.allSettled(running.map((a) => a.finished)).then(finish);
    } else {
      el.addEventListener("animationend", onEnd);
      el.addEventListener("transitionend", onEnd);
    }
    return () => {
      alive = false;
      window.clearTimeout(timer);
      el.removeEventListener("animationend", onEnd);
      el.removeEventListener("transitionend", onEnd);
    };
  }, [closing, exitMs]);

  return {
    mounted: mounted || open,
    state: closing && !open ? "closing" : "open",
    ref,
  };
}

const PresenceContext = createContext<PresenceHandle | null>(null);

/** Wraps a conditionally rendered surface and keeps showing the last thing it
 *  rendered while that plays its exit: `<Presence show={open}>{open && <Menu/>}</Presence>`. */
export function Presence({
  show,
  exitMs,
  children,
}: {
  show: boolean;
  /** The longest exit the surface plays; a fallback, not a wait. */
  exitMs?: number;
  children?: ReactNode;
}) {
  const presence = usePresence(show, { exitMs });
  const last = useRef<ReactNode>(null);
  if (show) last.current = children;
  // Opened again while its exit plays: a fresh copy, so it mounts as it always
  // did (autoFocus, mount effects, state reset).
  const generation = useRef(0);
  const wasLeaving = useRef(false);
  if (show && wasLeaving.current) generation.current += 1;
  wasLeaving.current = !show && presence.mounted;
  if (!presence.mounted) return null;
  return createElement(
    PresenceContext.Provider,
    { value: presence },
    createElement(
      Fragment,
      { key: generation.current },
      show ? children : last.current,
    ),
  );
}

/** Whether the surface this is rendered in is open or on its way out
 *  ("open" outside a Presence). */
export function usePresenceState(): PresenceState {
  return useContext(PresenceContext)?.state ?? "open";
}

/** The props for a surface's root inside a Presence: the exit-timing ref,
 *  `data-state` and `inert` while closing. `ownRef` is merged in. */
export function usePresenceProps<T extends Element>(ownRef?: Ref<T>) {
  const presence = useContext(PresenceContext);
  const state = presence?.state ?? "open";
  const ref = useMergedRef<T>(ownRef, presence?.ref);
  return {
    ref,
    "data-state": state,
    inert: state === "closing" ? true : undefined,
  };
}

/** A plain <div> that takes its Presence's exit wiring - for a surface too
 *  small to be a component of its own (a toast, a two-item menu). */
export function PresenceDiv({ ref, ...props }: ComponentProps<"div">) {
  const presence = usePresenceProps<HTMLDivElement>(ref);
  return createElement("div", { ...props, ...presence });
}

/** One stable ref callback that feeds several refs. */
export function useMergedRef<T>(
  ...refs: (Ref<T> | ((el: T | null) => void) | undefined)[]
): (el: T | null) => void {
  const latest = useRef(refs);
  latest.current = refs;
  return useCallback((el: T | null) => {
    for (const ref of latest.current) {
      if (typeof ref === "function") ref(el);
      else if (ref) (ref as { current: T | null }).current = el;
    }
  }, []);
}
