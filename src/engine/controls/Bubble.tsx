import {
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type HTMLAttributes,
  type ReactNode,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";
import { scaledPx } from "../tokens/chrome-scale";
import { useViewportClamp } from "../../utils/hooks/useViewportClamp";
import { usePresenceProps } from "../motion/usePresence";

/** How far the tail stays from the bubble's corners. */
const TAIL_INSET = 12;

/**
 * A bubble beside an element, its tail pointing at it: the one way the app
 * floats words next to something (a button's tooltip, a "?"'s card). Below
 * the element unless `side` says above, flipping where there is no room;
 * centred on it, or from its left edge with `align="start"`; kept inside the
 * window. In a portal on <body>, so no ancestor's transform or clip traps
 * it; inside a Presence it takes the exit wiring.
 */
export function Bubble({
  anchor,
  side = "below",
  align = "center",
  gap,
  className,
  style,
  children,
  ...rest
}: {
  anchor: RefObject<HTMLElement | null>;
  side?: "above" | "below";
  align?: "center" | "start";
  /** Between the element and the tail's tip, in design px. */
  gap: number;
  className: string;
  children: ReactNode;
} & Omit<HTMLAttributes<HTMLDivElement>, "children" | "className">) {
  const ref = useRef<HTMLDivElement>(null);
  const [at, setAt] = useState({ x: 0, y: 0, above: false });
  // The bubble's size is known only once in the DOM, so it is placed in a
  // layout effect, before the first paint.
  useLayoutEffect(() => {
    const box = anchor.current?.getBoundingClientRect();
    const el = ref.current;
    if (!box || !el) return;
    const width = el.offsetWidth;
    const height = el.offsetHeight;
    const space = scaledPx(gap);
    const aboveY = box.top - space - height;
    const belowY = box.bottom + space;
    const fitsAbove = aboveY >= 8;
    const fitsBelow = belowY + height <= window.innerHeight - 8;
    const above =
      side === "above" ? fitsAbove || !fitsBelow : !fitsBelow && fitsAbove;
    setAt({
      x: align === "start" ? box.left : box.left + box.width / 2 - width / 2,
      y: above ? aboveY : belowY,
      above,
    });
  }, [anchor, side, align, gap, children]);
  const pos = useViewportClamp(ref, at.x, at.y);

  // The tail under the element's middle, wherever the clamp moved the body.
  const [tailAt, setTailAt] = useState<number | null>(null);
  useLayoutEffect(() => {
    const box = anchor.current?.getBoundingClientRect();
    const width = ref.current?.offsetWidth ?? 0;
    if (!box || !width) return;
    const inset = scaledPx(TAIL_INSET);
    const middle = box.left + box.width / 2 - pos.left;
    setTailAt(
      Math.min(Math.max(middle, inset), Math.max(inset, width - inset)),
    );
  }, [anchor, pos.left, children]);

  const presence = usePresenceProps(ref);
  return createPortal(
    <div
      {...rest}
      {...presence}
      className={className}
      data-bubble-tail={at.above ? "bottom" : "top"}
      style={
        {
          ...style,
          ...pos,
          "--tail-at": tailAt === null ? undefined : `${tailAt}px`,
        } as CSSProperties
      }
    >
      {children}
    </div>,
    document.body,
  );
}
