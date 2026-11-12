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
import { usePlacement } from "./usePlacement";
import { sideThatFits, type PopupSide } from "./placement";
import { usePresenceProps } from "../motion/usePresence";

export type BubbleSide = PopupSide;

/** The edge of the bubble its tail leaves from: the one facing the
 *  element. */
const TAIL: Record<BubbleSide, string> = {
  above: "bottom",
  below: "top",
  left: "right",
  right: "left",
};

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
  side?: BubbleSide;
  align?: "center" | "start";
  /** Between the element and the tail's tip, in design px. */
  gap: number;
  className: string;
  children: ReactNode;
} & Omit<HTMLAttributes<HTMLDivElement>, "children" | "className">) {
  const ref = useRef<HTMLDivElement>(null);
  const [at, setAt] = useState<{ x: number; y: number; side: BubbleSide }>({
    x: 0,
    y: 0,
    side,
  });
  // The bubble's size is known only once in the DOM, so it is placed in a
  // layout effect, before the first paint.
  useLayoutEffect(() => {
    const box = anchor.current?.getBoundingClientRect();
    const el = ref.current;
    if (!box || !el) return;
    const width = el.offsetWidth;
    const height = el.offsetHeight;
    const space = scaledPx(gap);
    const placed = sideThatFits(side, box, { width, height }, space);
    const across = placed === "left" || placed === "right";
    setAt({
      x: across
        ? placed === "right"
          ? box.right + space
          : box.left - space - width
        : align === "start"
          ? box.left
          : box.left + box.width / 2 - width / 2,
      y: across
        ? box.top + box.height / 2 - height / 2
        : placed === "above"
          ? box.top - space - height
          : box.bottom + space,
      side: placed,
    });
  }, [anchor, side, align, gap, children]);
  const pos = usePlacement(ref, at.x, at.y);

  // The tail at the element's middle, wherever the clamp moved the body:
  // along its top or bottom edge, or its left or right one.
  const across = at.side === "left" || at.side === "right";
  const [tailAt, setTailAt] = useState<number | null>(null);
  useLayoutEffect(() => {
    const box = anchor.current?.getBoundingClientRect();
    const el = ref.current;
    const length = (across ? el?.offsetHeight : el?.offsetWidth) ?? 0;
    if (!box || !length) return;
    const inset = scaledPx(TAIL_INSET);
    const middle = across
      ? box.top + box.height / 2 - pos.top
      : box.left + box.width / 2 - pos.left;
    setTailAt(
      Math.min(Math.max(middle, inset), Math.max(inset, length - inset)),
    );
  }, [anchor, across, pos.left, pos.top, children]);

  const presence = usePresenceProps(ref);
  return createPortal(
    <div
      {...rest}
      {...presence}
      className={className}
      data-bubble-tail={TAIL[at.side]}
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
