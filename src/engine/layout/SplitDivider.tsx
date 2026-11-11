import { frameLayout } from "../frame/frame-store";
import "../controls/resize-handle.css";
import { useRef, useState, type CSSProperties } from "react";
import { ContextMenu } from "../controls/ContextMenu";
import type { Strings } from "../../i18n/strings";
import { Presence } from "../motion/usePresence";
import { chromeScale } from "../tokens/chrome-scale";
import { panelWidth, setPanelWidth } from "../frame/panel-width";
import { arrangeBranch, closeSplit } from "./store";
import { type SplitLayout } from "./ops";
import { nodeAt, type Divider } from "./tree";

/** How far one arrow key press moves the divider: a share of the two
 *  panes it parts, or a panel's width in pixels. */
const KEY_STEP = 0.05;
const KEY_PIXELS = 24;

type Span = { start: number; end: number };

/** The line between two panes (or groups of them): drag or arrow keys
 *  resize the two, double click evens them, right-click turns their
 *  branch, swaps them or closes the split. */
export function SplitDivider({
  layout,
  line,
  style,
  frame,
  reach,
  sides,
  fixed,
  t,
}: {
  layout: SplitLayout;
  line: Divider;
  style: CSSProperties;
  /** Its key in the window's frame. */
  frame: string;
  /** It starts at the islands' top: dragged, its line reaches up through
   *  the rows of tabs there. */
  reach: boolean;
  /** The two sides it parts, in the area's pixels (frame/solve.ts). */
  sides: { before: Span; after: Span };
  /** The side that is a panel's island, sized in pixels, not shares. */
  fixed: "before" | "after" | null;
  t: Strings;
}) {
  const row = line.direction === "row";
  const drag = useRef<{ origin: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const branch = nodeAt(layout.root, line.path);
  const sizes = branch?.kind === "split" ? branch.sizes : [0.5, 0.5];
  const current =
    sizes[line.index] / (sizes[line.index] + sizes[line.index + 1]);
  const share = (value: number) =>
    arrangeBranch(line.path, { index: line.index, share: value });
  const { before, after } = sides;
  // The divider at `at` (the area's pixels): a panel takes its width from
  // it, two documents their shares.
  const moveTo = (at: number) => {
    if (fixed === "after")
      setPanelWidth((after.end - at - gapHalf(sides)) / chromeScale());
    else if (fixed === "before")
      setPanelWidth((at - before.start - gapHalf(sides)) / chromeScale());
    else share((at - before.start) / (after.end - before.start));
  };
  const step = (sign: number) => {
    if (fixed)
      setPanelWidth(
        panelWidth() + (fixed === "after" ? -sign : sign) * KEY_PIXELS,
      );
    else share(current + sign * KEY_STEP);
  };
  const end = () => {
    drag.current = null;
    setDragging(false);
  };
  return (
    <>
      <div
        className={`split-divider tx-grip split-divider-${line.direction}${dragging ? " split-divider-active" : ""}`}
        data-gripped={dragging || undefined}
        data-reach={reach || undefined}
        style={style}
        data-frame={frame}
        role="separator"
        aria-orientation={row ? "vertical" : "horizontal"}
        aria-label={t.splitDivider}
        aria-valuenow={Math.round(current * 100)}
        aria-valuemin={0}
        aria-valuemax={100}
        tabIndex={0}
        onPointerDown={(e) => {
          if (e.button !== 0) return;
          e.preventDefault();
          e.currentTarget.setPointerCapture(e.pointerId);
          const { origin } = frameLayout();
          drag.current = { origin: row ? origin.x : origin.y };
          setDragging(true);
        }}
        onPointerMove={(e) => {
          const d = drag.current;
          if (!d) return;
          moveTo((row ? e.clientX : e.clientY) - d.origin);
        }}
        onPointerUp={end}
        onPointerCancel={end}
        onLostPointerCapture={end}
        onContextMenu={(e) => {
          e.preventDefault();
          setMenu({ x: e.clientX, y: e.clientY });
        }}
        onKeyDown={(e) => {
          const back = row ? "ArrowLeft" : "ArrowUp";
          const on = row ? "ArrowRight" : "ArrowDown";
          if (e.key === back) step(-1);
          else if (e.key === on) step(1);
          else return;
          e.preventDefault();
        }}
      />
      <Presence show={menu !== null}>
        {menu && (
          <ContextMenu
            x={menu.x}
            y={menu.y}
            // Turning, swapping and sizing are drags: only this is not.
            items={[{ label: t.menuCloseSplit, onSelect: closeSplit }]}
            onClose={() => setMenu(null)}
          />
        )}
      </Presence>
    </>
  );
}

/** Half the gap between the two sides: the divider sits in its middle. */
const gapHalf = ({ before, after }: { before: Span; after: Span }) =>
  (after.start - before.end) / 2;
