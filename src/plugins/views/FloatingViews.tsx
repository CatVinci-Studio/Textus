import { Tooltip } from "../../engine/controls/Tooltip";
import { fill } from "../../i18n/fill";
import { trackDrag } from "../../engine/drag/pointer-drag";
import { useEffect, useState, useSyncExternalStore } from "react";
import { useChromeScale } from "../../engine/controls/useChromeScale";
import { scaledPx } from "../../engine/tokens/chrome-scale";
import { windowInfo } from "../store/plugin-records";
import {
  ContextMenu,
  type ContextMenuEntry,
} from "../../engine/controls/ContextMenu";
import { Presence } from "../../engine/motion/usePresence";
import { PluginWebviewPanel } from "./PluginWebview";
import { DesktopFloating, DOT_SIZE as DOT } from "./desktop-floating";
import { ResizeGrip } from "./ResizeGrip";
import {
  closeFloating,
  floatingOnDesktop,
  floatingSide,
  floatingSize,
  floatingMenuItems,
  floatingVersion,
  moveFloating,
  openFloatingViews,
  subscribeFloating,
  touchFloating,
  type FloatingView,
} from "./floating-views";

/** Kept this far inside the window's edges, so a view can't be lost. */
const MARGIN = 18;
/** Let go this near an edge, it settles against it. */
const SNAP = 52;

/**
 * Plugins' floating views shown in this window: each a frame of its own
 * size over the editor, dragged anywhere to move it, folded to a dot or
 * closed from its right-click menu.
 */
const onResize = (changed: () => void) => {
  window.addEventListener("resize", changed);
  return () => window.removeEventListener("resize", changed);
};
const windowSize = () => `${window.innerWidth}x${window.innerHeight}`;

export function FloatingViews() {
  useSyncExternalStore(subscribeFloating, floatingVersion);
  // Placed again as the window resizes: kept inside it.
  useSyncExternalStore(onResize, windowSize);
  const [canFloat, setCanFloat] = useState(false);
  useEffect(() => {
    void floatingOnDesktop().then(setCanFloat);
  }, []);
  const open = openFloatingViews();
  const here = open.filter((v) => v.place === "window");
  const desktop = open.filter((v) => v.place === "desktop");
  return (
    <>
      {desktop.map((view) => (
        <DesktopFloating key={view.view} view={view} />
      ))}
      {here.length > 0 && (
        <div className="floating-views">
          {here.map((view) => (
            <FloatingBox key={view.view} view={view} desktop={canFloat} />
          ))}
        </div>
      )}
    </>
  );
}

function clamp(value: number, size: number, room: number) {
  const margin = scaledPx(MARGIN);
  return Math.min(
    Math.max(value, margin),
    Math.max(margin, room - size - margin),
  );
}

function snap(value: number, size: number, room: number) {
  const margin = scaledPx(MARGIN);
  const far = room - size - margin;
  if (value - margin < scaledPx(SNAP)) return margin;
  return far - value < scaledPx(SNAP) ? far : value;
}

/** Its top-left in pixels: where it was left, else the bottom-right
 *  corner. */
function position(view: FloatingView, width: number, height: number) {
  const w = window.innerWidth;
  const h = window.innerHeight;
  const x = view.x === null ? w : view.x * w;
  const y = view.y === null ? h : view.y * h;
  return { left: clamp(x, width, w), top: clamp(y, height, h) };
}

function FloatingBox({
  view,
  desktop,
}: {
  view: FloatingView;
  /** Whether it can be sent to the desktop from here. */
  desktop: boolean;
}) {
  const t = windowInfo().strings();
  const [live, setLive] = useState<{ left: number; top: number } | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  /** The scale while the user resizes it. */
  const [sizing, setSizing] = useState<number | null>(null);
  const chrome = useChromeScale();
  const [fullWidth, fullHeight] = floatingSize(
    { ...view, scale: sizing ?? view.scale },
    chrome,
  );
  // Never larger than the window, its margins kept.
  const room = (n: number) => n - 2 * scaledPx(MARGIN);
  const width = view.folded
    ? DOT * chrome
    : Math.min(fullWidth, room(window.innerWidth));
  const height = view.folded
    ? DOT * chrome
    : Math.min(fullHeight, room(window.innerHeight));
  const side = floatingSide(view);
  const at =
    live ??
    (sizing === null ? null : resized(sizing)) ??
    position(view, width, height);

  /** Resized, its bottom and outer edge stay where they were. */
  function resized(scale: number) {
    const [w, h] = floatingSize(view, chrome);
    const [toW, toH] = floatingSize({ ...view, scale }, chrome);
    const was = position(view, w, h);
    const left = side === "left" ? was.left : was.left + w - toW;
    return {
      left: clamp(left, toW, window.innerWidth),
      top: clamp(was.top + h - toH, toH, window.innerHeight),
    };
  }

  // Dragged anywhere, it moves (trackDrag's threshold: a tremor is still
  // a click); let go, it lands; Esc puts it back.
  const start = (event: React.PointerEvent) => {
    const dx = event.clientX - at.left;
    const dy = event.clientY - at.top;
    let to: { left: number; top: number } | null = null;
    trackDrag(event.nativeEvent, {
      move: (x, y) => {
        to = {
          left: clamp(x - dx, width, window.innerWidth),
          top: clamp(y - dy, height, window.innerHeight),
        };
        setLive(to);
      },
      end: (_x, _y, dropped) => {
        if (dropped && to) {
          moveFloating(view.view, {
            x: snap(to.left, width, window.innerWidth) / window.innerWidth,
            y: snap(to.top, height, window.innerHeight) / window.innerHeight,
          });
          touchFloating(view.view, "moved");
        }
        setLive(null);
      },
    });
  };
  const dragHandlers = { onPointerDown: start };

  if (view.folded)
    return (
      <Tooltip text={view.title} description={null}>
        <button
          type="button"
          className="floating-view-dot"
          style={{ left: at.left, top: at.top }}
          aria-label={fill(t.floatingUnfold, { name: view.title })}
          {...dragHandlers}
          onClick={() => moveFloating(view.view, { folded: false })}
        >
          {view.icon ? <img src={view.icon} alt="" /> : view.title.slice(0, 1)}
        </button>
      </Tooltip>
    );

  const own = floatingMenuItems(view);
  const items: ContextMenuEntry[] = [
    ...own.map((item) => ({ label: item.label, onSelect: item.onSelect })),
    ...(own.length ? (["separator"] as const) : []),
    ...(view.allowed === "either" && desktop
      ? [
          {
            label: fill(t.floatingToDesktop, { name: view.title }),
            onSelect: () => moveFloating(view.view, { place: "desktop" }),
          },
        ]
      : []),
    {
      label: fill(t.floatingFold, { name: view.title }),
      onSelect: () => moveFloating(view.view, { folded: true }),
    },
    "separator",
    {
      label: fill(t.floatingClose, { name: view.title }),
      onSelect: () => closeFloating(view.view),
    },
  ];

  return (
    <div
      className="floating-view"
      data-floating-view={view.view}
      data-dragging={live ? "" : undefined}
      role="dialog"
      aria-label={view.title}
      style={{ left: at.left, top: at.top, width, height }}
    >
      <PluginWebviewPanel
        plugin={view.plugin}
        view={view.view}
        kind="floating"
      />
      {/* The page is looked at, not clicked: dragging anywhere moves it,
          and its menu is a right-click away. */}
      <div
        className="floating-view-handle"
        {...dragHandlers}
        // A click, no drag: the page is poked (a pet's reaction).
        onClick={() => touchFloating(view.view, "poke")}
        onContextMenu={(e) => {
          e.preventDefault();
          setMenu({ x: e.clientX, y: e.clientY });
        }}
      />
      <ResizeGrip
        side={side}
        scale={view.scale}
        width={view.width}
        height={view.height}
        onResize={setSizing}
        onDone={(scale) => {
          const to = resized(scale);
          setSizing(null);
          moveFloating(view.view, {
            scale,
            x: to.left / window.innerWidth,
            y: to.top / window.innerHeight,
          });
        }}
      />
      <Presence show={menu !== null}>
        {menu && (
          <ContextMenu
            x={menu.x}
            y={menu.y}
            items={items}
            onClose={() => setMenu(null)}
          />
        )}
      </Presence>
    </div>
  );
}
