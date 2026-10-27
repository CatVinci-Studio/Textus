import { useRef, useState, type CSSProperties } from "react";
import { ContextMenu } from "../../ui/ContextMenu";
import type { Strings } from "../../i18n/strings";
import { Presence } from "../../ui/usePresence";
import {
  arrangeSplit,
  clampRatio,
  closeSplit,
  setSplitLayout,
  splitLayout,
  type SplitLayout,
} from "./split-layout";

/** How far one arrow key press moves the divider. */
const KEY_STEP = 0.05;

/**
 * The split's grid in the document column. Every tab's editor stays a child
 * of the column, so a tab moving into a pane keeps its undo and scroll.
 */
export function splitGridStyles(layout: SplitLayout): {
  column: CSSProperties;
  bars: [CSSProperties, CSSProperties];
  first: CSSProperties;
  divider: CSSProperties;
  second: CSSProperties;
} {
  const a = `minmax(0, ${layout.ratio}fr)`;
  const b = `minmax(0, ${1 - layout.ratio}fr)`;
  // Each pane is its tab bar over its document.
  if (layout.direction === "row")
    return {
      column: {
        gridTemplateColumns: `${a} 1px ${b}`,
        gridTemplateRows: "auto minmax(0, 1fr)",
      },
      bars: [
        { gridColumn: 1, gridRow: 1 },
        { gridColumn: 3, gridRow: 1 },
      ],
      first: { gridColumn: 1, gridRow: 2 },
      divider: { gridColumn: 2, gridRow: "1 / span 2" },
      second: { gridColumn: 3, gridRow: 2 },
    };
  return {
    column: {
      gridTemplateColumns: "minmax(0, 1fr)",
      gridTemplateRows: `auto ${a} 1px auto ${b}`,
    },
    bars: [{ gridRow: 1 }, { gridRow: 4 }],
    first: { gridRow: 2 },
    divider: { gridRow: 3 },
    second: { gridRow: 5 },
  };
}

/** The line between the panes: drag or arrow keys resize, double click
 *  halves, right-click turns, swaps or closes the split. */
export function SplitDivider({
  layout,
  style,
  t,
}: {
  layout: SplitLayout;
  style: CSSProperties;
  t: Strings;
}) {
  const row = layout.direction === "row";
  const drag = useRef<{ start: number; size: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const share = (ratio: number) => {
    const now = splitLayout();
    if (now) setSplitLayout({ ...now, ratio: clampRatio(ratio) });
  };
  const end = () => {
    drag.current = null;
    setDragging(false);
  };
  const turn = () => {
    const now = splitLayout();
    if (now)
      setSplitLayout({
        ...now,
        direction: now.direction === "row" ? "column" : "row",
      });
  };
  return (
    <>
      <div
        className={`split-divider${dragging ? " split-divider-active" : ""}`}
        style={style}
        role="separator"
        aria-orientation={row ? "vertical" : "horizontal"}
        aria-label={t.splitDivider}
        aria-valuenow={Math.round(layout.ratio * 100)}
        aria-valuemin={20}
        aria-valuemax={80}
        tabIndex={0}
        onPointerDown={(e) => {
          if (e.button !== 0) return;
          e.preventDefault();
          e.currentTarget.setPointerCapture(e.pointerId);
          // The panes' span: from the first's start to the second's end.
          const panes =
            e.currentTarget.parentElement?.querySelectorAll<HTMLElement>(
              ":scope > .split-pane",
            );
          const rects = [...(panes ?? [])].map((p) =>
            p.getBoundingClientRect(),
          );
          if (rects.length < 2) return;
          const start = Math.min(...rects.map((r) => (row ? r.left : r.top)));
          const finish = Math.max(
            ...rects.map((r) => (row ? r.right : r.bottom)),
          );
          drag.current = { start, size: finish - start };
          setDragging(true);
        }}
        onPointerMove={(e) => {
          const d = drag.current;
          if (!d || d.size <= 0) return;
          share(((row ? e.clientX : e.clientY) - d.start) / d.size);
        }}
        onPointerUp={end}
        onPointerCancel={end}
        onLostPointerCapture={end}
        onDoubleClick={() => share(0.5)}
        onContextMenu={(e) => {
          e.preventDefault();
          setMenu({ x: e.clientX, y: e.clientY });
        }}
        onKeyDown={(e) => {
          const back = row ? "ArrowLeft" : "ArrowUp";
          const on = row ? "ArrowRight" : "ArrowDown";
          if (e.key === back) share(layout.ratio - KEY_STEP);
          else if (e.key === on) share(layout.ratio + KEY_STEP);
          else return;
          e.preventDefault();
        }}
      />
      <Presence show={menu !== null} exitMs={120}>
        {menu && (
          <ContextMenu
            x={menu.x}
            y={menu.y}
            items={[
              { label: t.splitTurn, onSelect: turn },
              {
                label: t.splitSwap,
                onSelect: () => arrangeSplit({ swap: true }),
              },
              { label: t.splitEven, onSelect: () => share(0.5) },
              "separator",
              { label: t.menuCloseSplit, onSelect: closeSplit },
            ]}
            onClose={() => setMenu(null)}
          />
        )}
      </Presence>
    </>
  );
}
