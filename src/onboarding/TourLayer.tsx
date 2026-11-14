import {
  useCallback,
  useEffect,
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

/** `beside` cut clear of `hole`, so the two holes never overlap. */
function apart(hole: Box, beside: Box): Box | null {
  const left = Math.max(beside.left, hole.left + hole.width);
  const right = beside.left + beside.width;
  return right - left > 0 ? { ...beside, left, width: right - left } : null;
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
  const [cardSize, setCardSize] = useState({ width: 320, height: 160 });
  useEffect(() => {
    const el = card.current;
    if (!el) return;
    const measure = () => {
      setView(viewNow());
      setCardSize({ width: el.offsetWidth, height: el.offsetHeight });
    };
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    window.addEventListener("resize", measure);
    const escape = (e: KeyboardEvent) => e.key === "Escape" && onEscape();
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

  const hole = box && holeAround(box, view);
  const draw = useCallback((frame: TourFrame) => {
    path.current?.setAttribute(
      "d",
      scrimPath(viewNow(), [frame.hole, frame.extra]),
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
    if (card.current)
      card.current.style.transform = `translate(${frame.card.left}px, ${frame.card.top}px)`;
  }, []);
  // The card goes beside the lit part and whatever it keeps clear of.
  const anchor = hole && besideBox ? across(hole, besideBox) : hole;
  const extra = hole && besideBox ? apart(hole, besideBox) : null;
  useGlide(
    { hole, extra, card: placeCard(anchor, cardSize, view, phone) },
    draw,
  );

  return (
    <div className="tour-layer">
      {!open && (
        <svg className="tour-scrim" width="100%" height="100%" aria-hidden>
          <path ref={path} fillRule="evenodd" />
        </svg>
      )}
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
