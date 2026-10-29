import { useRef, useState, type CSSProperties } from "react";
import { ContextMenu } from "../../ui/ContextMenu";
import type { Strings } from "../../i18n/strings";
import { Presence } from "../../ui/usePresence";
import { arrangeBranch, closeSplit, type SplitLayout } from "./split-layout";
import { nodeAt, panesOf, type Divider } from "./split-tree";

/** How far one arrow key press moves the divider, as a share of the two
 *  panes it parts. */
const KEY_STEP = 0.05;

/** Where the panes on one side of a divider are drawn, together. */
function extent(layout: SplitLayout, line: Divider, child: number) {
  const node = nodeAt(layout.root, [...line.path, child]);
  const rects = (node ? panesOf(node) : []).flatMap((p) =>
    [
      ...document.querySelectorAll<HTMLElement>(
        `.main-pane-split > [data-pane-id="${CSS.escape(p.id)}"]`,
      ),
    ].map((el) => el.getBoundingClientRect()),
  );
  const row = line.direction === "row";
  return {
    start: Math.min(...rects.map((r) => (row ? r.left : r.top))),
    end: Math.max(...rects.map((r) => (row ? r.right : r.bottom))),
  };
}

/** The line between two panes (or groups of them): drag or arrow keys
 *  resize the two, double click evens them, right-click turns their
 *  branch, swaps them or closes the split. */
export function SplitDivider({
  layout,
  line,
  style,
  t,
}: {
  layout: SplitLayout;
  line: Divider;
  style: CSSProperties;
  t: Strings;
}) {
  const row = line.direction === "row";
  const drag = useRef<{ start: number; size: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const branch = nodeAt(layout.root, line.path);
  const sizes = branch?.kind === "split" ? branch.sizes : [0.5, 0.5];
  const current =
    sizes[line.index] / (sizes[line.index] + sizes[line.index + 1]);
  const share = (value: number) =>
    arrangeBranch(line.path, { index: line.index, share: value });
  const end = () => {
    drag.current = null;
    setDragging(false);
  };
  return (
    <>
      <div
        className={`split-divider split-divider-${line.direction}${dragging ? " split-divider-active" : ""}`}
        style={style}
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
          const before = extent(layout, line, line.index);
          const after = extent(layout, line, line.index + 1);
          drag.current = {
            start: before.start,
            size: after.end - before.start,
          };
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
          if (e.key === back) share(current - KEY_STEP);
          else if (e.key === on) share(current + KEY_STEP);
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
              {
                label: t.splitTurn,
                onSelect: () => arrangeBranch(line.path, "turn"),
              },
              {
                label: t.splitSwap,
                onSelect: () => arrangeBranch(line.path, { swap: line.index }),
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
