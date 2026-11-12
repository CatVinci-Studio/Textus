import { frameLayout } from "../frame/frame-store";
import { GRIP_KEY_STEP, gripKey, useGrip } from "../frame/useGrip";
import "../controls/resize-handle.css";
import { useState, type CSSProperties } from "react";
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

type Span = { start: number; end: number };

/** The line between two panes (or groups of them): drag or arrow keys
 *  resize the two; right-click closes the split. */
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
  fixed: "before" | "after" | "both" | null;
  t: Strings;
}) {
  const row = line.direction === "row";
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const branch = nodeAt(layout.root, line.path);
  const sizes = branch?.kind === "split" ? branch.sizes : [0.5, 0.5];
  const current =
    sizes[line.index] / (sizes[line.index] + sizes[line.index + 1]);
  const share = (value: number) =>
    arrangeBranch(line.path, { index: line.index, share: value });
  const { before, after } = sides;
  const still = fixed === "both";
  // The divider at `at` (the area's pixels): a panel takes its width from
  // it, two documents their shares.
  // A panel's width is drawn as the pointer moves, kept once let go.
  const moveTo = (at: number) => {
    if (fixed === "both") return;
    if (fixed === "after")
      setPanelWidth((after.end - at - gapHalf(sides)) / chromeScale(), false);
    else if (fixed === "before")
      setPanelWidth(
        (at - before.start - gapHalf(sides)) / chromeScale(),
        false,
      );
    // Two documents share the length less the gap the divider sits in, so
    // grabbing it doesn't make it jump.
    else
      share(
        (at - before.start - gapHalf(sides)) /
          (after.end - before.start - 2 * gapHalf(sides)),
      );
  };
  // A panel's width as the solver drew it, in interface pixels: what a key
  // steps from and a drag keeps, so a width it can't draw is never stored.
  const drawn = () => {
    const span = fixed === "after" ? after : before;
    return (span.end - span.start) / chromeScale();
  };
  const step = (sign: number) => {
    if (fixed === "both") return;
    if (fixed)
      setPanelWidth(
        drawn() + (fixed === "after" ? -sign : sign) * GRIP_KEY_STEP,
      );
    else share(current + sign * KEY_STEP);
  };
  const grip = useGrip({
    start: () => {
      const { origin } = frameLayout();
      return { origin: row ? origin.x : origin.y };
    },
    move: (e, held) => moveTo((row ? e.clientX : e.clientY) - held.origin),
    end: (_held, how) => {
      if (fixed === "before" || fixed === "after")
        setPanelWidth(how === "gone" ? panelWidth() : drawn(), true);
    },
  });
  return (
    <>
      <div
        // Between two panels, each its own width: a gap, nothing to drag.
        className={`split-divider${still ? "" : " tx-grip"} split-divider-${line.direction}${grip.gripped ? " split-divider-active" : ""}`}
        data-gripped={grip.gripped || undefined}
        data-reach={reach || undefined}
        style={style}
        data-frame={frame}
        role="separator"
        aria-orientation={row ? "vertical" : "horizontal"}
        aria-label={t.splitDivider}
        aria-valuenow={Math.round(current * 100)}
        aria-valuemin={0}
        aria-valuemax={100}
        tabIndex={still ? -1 : 0}
        {...(still ? {} : grip.props)}
        onContextMenu={(e) => {
          e.preventDefault();
          setMenu({ x: e.clientX, y: e.clientY });
        }}
        onKeyDown={(e) => {
          const sign = gripKey(e.key, line.direction);
          if (!sign) return;
          step(sign);
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
