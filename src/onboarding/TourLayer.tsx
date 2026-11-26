import {
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";
import { holeAround, placeCard, type Box } from "./tour-place";
import { useGlide, useTargetBox, type TourFrame } from "./tour-glide";
import "./TourLayer.css";

/** The hole's corner radius: --shape-m, as the ring's. */
const RADIUS = 14;
const NO_SIZE = { width: 0, height: 0 };

/** One rounded hole, as a path cut from the scrim; "" with none. */
function holePath(hole: Box | null): string {
  if (!hole || hole.width <= 0 || hole.height <= 0) return "";
  const r = Math.min(RADIUS, hole.width / 2, hole.height / 2);
  const { left: x, top: y, width: w, height: h } = hole;
  return (
    `M${x + r} ${y}H${x + w - r}A${r} ${r} 0 0 1 ${x + w} ${y + r}` +
    `V${y + h - r}A${r} ${r} 0 0 1 ${x + w - r} ${y + h}H${x + r}` +
    `A${r} ${r} 0 0 1 ${x} ${y + h - r}V${y + r}A${r} ${r} 0 0 1 ${x + r} ${y}Z`
  );
}

/** The dimmed window with its holes cut (evenodd: they must not overlap). */
function scrimPath(
  view: { width: number; height: number },
  holes: (Box | null)[],
) {
  return `M0 0H${view.width}V${view.height}H0Z` + holes.map(holePath).join("");
}

/** Whether two boxes share any of their area. */
const overlap = (a: Box, b: Box) =>
  a.left < b.left + b.width &&
  b.left < a.left + a.width &&
  a.top < b.top + b.height &&
  b.top < a.top + a.height;

/** `beside` cut back to start past `lit`'s right edge, when `lit` sits at
 *  its left; null when that leaves nothing. */
function pastRight(beside: Box, lit: Box): Box | null {
  const left = lit.left + lit.width;
  const right = beside.left + beside.width;
  if (lit.left > beside.left || left >= right) return null;
  return { ...beside, left, width: right - left };
}

/** The smallest box holding both. */
function union(a: Box, b: Box): Box {
  const left = Math.min(a.left, b.left);
  const top = Math.min(a.top, b.top);
  return {
    left,
    top,
    width: Math.max(a.left + a.width, b.left + b.width) - left,
    height: Math.max(a.top + a.height, b.top + b.height) - top,
  };
}

/** `hole` widened across `beside`: the card goes past both, level with
 *  the lit part. */
function across(hole: Box, beside: Box): Box {
  const left = Math.min(hole.left, beside.left);
  const right = Math.max(hole.left + hole.width, beside.left + beside.width);
  return { ...hole, left, width: right - left };
}

const viewNow = () => ({
  width: window.innerWidth,
  height: window.innerHeight,
});

/** The window's size and the card's, followed as either changes; Esc
 *  calls `onEscape`. */
function useTourView(
  card: RefObject<HTMLDivElement | null>,
  onEscape: () => void,
) {
  const [view, setView] = useState(viewNow);
  // Measured before the first paint, so no guess is ever drawn.
  const [cardSize, setCardSize] = useState<{
    width: number;
    height: number;
  } | null>(null);
  useLayoutEffect(() => {
    const el = card.current;
    if (!el) return;
    const measure = () => {
      setView(viewNow());
      // Its own width, not one a step narrowed it to (or it would widen
      // and narrow again, back and forth).
      setCardSize((was) => ({
        width: el.style.width && was ? was.width : el.offsetWidth,
        height: el.offsetHeight,
      }));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    window.addEventListener("resize", measure);
    // Not an Esc something else took (completion, find, a menu, the IME),
    // nor one in a text the step has the learner type in.
    const escape = (e: KeyboardEvent) =>
      e.key === "Escape" &&
      !e.defaultPrevented &&
      !e.isComposing &&
      !(e.target as HTMLElement | null)?.closest?.(
        "input, textarea, [contenteditable='true']",
      ) &&
      onEscape();
    window.addEventListener("keydown", escape);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", measure);
      window.removeEventListener("keydown", escape);
    };
  }, [card, onEscape]);
  return { view, cardSize };
}

/**
 * The tour over the window: everything dimmed but the part a step is about,
 * which stays in use, ringed, and a small card beside it. Moving on, the
 * hole and the card glide to the next part together. `open` leaves the
 * window undimmed (a step that sends the learner elsewhere).
 */
export function TourLayer({
  target,
  beside,
  open,
  phone,
  labelledBy,
  onEscape,
  children,
}: {
  target: string | null;
  /** What the card keeps clear of, besides the lit part. */
  beside?: string;
  open: boolean;
  phone: boolean;
  labelledBy: string;
  onEscape: () => void;
  children: ReactNode;
}) {
  const box = useTargetBox(target);
  const besideBox = useTargetBox(beside ?? null);
  const card = useRef<HTMLDivElement>(null);
  const path = useRef<SVGPathElement>(null);
  const ring = useRef<HTMLDivElement>(null);
  const { view, cardSize } = useTourView(card, onEscape);

  // The ring round the part the step is about, and only it; what that part
  // opened (the sidebar) stays undimmed beside it, cut back where the two
  // meet, or joined into one hole when it can't be.
  const lit = box && holeAround(box, view);
  const meet = !!lit && !!besideBox && overlap(lit, besideBox);
  const trimmed = lit && besideBox && meet ? pastRight(besideBox, lit) : null;
  const joined = meet && !trimmed;
  const hole = lit && joined ? union(lit, besideBox!) : lit;
  const besideHole =
    lit && besideBox && !joined ? (trimmed ?? besideBox) : null;
  const draw = useCallback((frame: TourFrame) => {
    path.current?.setAttribute(
      "d",
      scrimPath(viewNow(), [frame.hole, frame.beside ?? null]),
    );
    const ringEl = ring.current;
    if (ringEl) {
      ringEl.hidden = !frame.hole;
      if (frame.hole) {
        const { left, top, width, height } = frame.hole;
        ringEl.style.transform = `translate(${left}px, ${top}px)`;
        ringEl.style.width = `${width}px`;
        ringEl.style.height = `${height}px`;
      }
    }
    if (card.current) {
      card.current.style.transform = `translate(${frame.card.left}px, ${frame.card.top}px)`;
      // Narrowed to stay beside the hole when it can't go round it.
      card.current.style.width = frame.card.width
        ? `${frame.card.width}px`
        : "";
    }
  }, []);
  // The card beside it all, level with the part the step is about.
  const all = hole && besideHole ? union(hole, besideHole) : hole;
  const anchor = lit && all ? across(lit, all) : all;
  useGlide(
    {
      hole,
      beside: besideHole,
      card: placeCard(anchor, cardSize ?? NO_SIZE, view, phone, all),
    },
    draw,
    cardSize !== null,
  );

  return (
    <div className="tour-layer">
      {/* Kept while open, hidden: mounted again it would wait for the next
          draw to dim anything. */}
      <svg
        className="tour-scrim"
        width="100%"
        height="100%"
        aria-hidden
        data-open={open || undefined}
      >
        <path ref={path} fillRule="evenodd" />
      </svg>
      <div ref={ring} className="tour-ring" hidden />
      <div
        ref={card}
        className="tour-card floating-surface"
        role="dialog"
        aria-modal="false"
        aria-labelledby={labelledBy}
      >
        {children}
      </div>
    </div>
  );
}
