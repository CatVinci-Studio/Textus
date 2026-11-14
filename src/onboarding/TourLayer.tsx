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

/** The dimmed window with a rounded hole cut where `hole` is. */
function scrimPath(view: { width: number; height: number }, hole: Box | null) {
  const outer = `M0 0H${view.width}V${view.height}H0Z`;
  if (!hole || hole.width <= 0 || hole.height <= 0) return outer;
  const r = Math.min(RADIUS, hole.width / 2, hole.height / 2);
  const { left: x, top: y, width: w, height: h } = hole;
  return (
    `${outer}M${x + r} ${y}H${x + w - r}A${r} ${r} 0 0 1 ${x + w} ${y + r}` +
    `V${y + h - r}A${r} ${r} 0 0 1 ${x + w - r} ${y + h}H${x + r}` +
    `A${r} ${r} 0 0 1 ${x} ${y + h - r}V${y + r}A${r} ${r} 0 0 1 ${x + r} ${y}Z`
  );
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
  open,
  phone,
  labelledBy,
  onEscape,
  children,
}: {
  target: string | null;
  open: boolean;
  phone: boolean;
  labelledBy: string;
  onEscape: () => void;
  children: ReactNode;
}) {
  const box = useTargetBox(target);
  const card = useRef<HTMLDivElement>(null);
  const path = useRef<SVGPathElement>(null);
  const ring = useRef<HTMLDivElement>(null);
  const { view, cardSize } = useTourView(card, onEscape);

  const hole = box && holeAround(box, view);
  const draw = useCallback((frame: TourFrame) => {
    path.current?.setAttribute("d", scrimPath(viewNow(), frame.hole));
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
  useGlide({ hole, card: placeCard(hole, cardSize, view, phone) }, draw);

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
