import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { windowInfo } from "../store/plugin-records";
import { ContextMenu, type ContextMenuEntry } from "../../ui/ContextMenu";
import { Presence } from "../../ui/usePresence";
import { PluginWebviewPanel } from "./PluginWebview";
import { DesktopFloating, DOT_SIZE as DOT } from "./desktop-floating";
import {
  closeFloating,
  floatingOnDesktop,
  floatingVersion,
  moveFloating,
  openFloatingViews,
  subscribeFloating,
  touchFloating,
  type FloatingView,
} from "./floating-views";

/** Kept this far inside the window's edges, so a view can't be lost. */
const MARGIN = 8;

/**
 * Plugins' floating views shown in this window: each a frame of its own
 * size over the editor, dragged anywhere to move it, folded to a dot or
 * closed from its right-click menu.
 */
export function FloatingViews() {
  useSyncExternalStore(subscribeFloating, floatingVersion);
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
  return Math.min(
    Math.max(value, MARGIN),
    Math.max(MARGIN, room - size - MARGIN),
  );
}

/** Its top-left in pixels: where it was left, else the bottom-right
 *  corner. */
function position(view: FloatingView, width: number, height: number) {
  const w = window.innerWidth;
  const h = window.innerHeight;
  const x = view.x === null ? w - width - 24 : view.x * w;
  const y = view.y === null ? h - height - 48 : view.y * h;
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
  const [drag, setDrag] = useState<{
    dx: number;
    dy: number;
    x: number;
    y: number;
  } | null>(null);
  const [live, setLive] = useState<{ left: number; top: number } | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const moved = useRef(false);
  const width = view.folded ? DOT : view.width;
  const height = view.folded ? DOT : view.height;
  const at = live ?? position(view, width, height);

  const start = (event: React.PointerEvent) => {
    if (event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    moved.current = false;
    setDrag({
      dx: event.clientX - at.left,
      dy: event.clientY - at.top,
      x: event.clientX,
      y: event.clientY,
    });
  };
  const move = (event: React.PointerEvent) => {
    if (!drag) return;
    // A hand's tremor is still a click.
    if (Math.hypot(event.clientX - drag.x, event.clientY - drag.y) < 4) return;
    moved.current = true;
    setLive({
      left: clamp(event.clientX - drag.dx, width, window.innerWidth),
      top: clamp(event.clientY - drag.dy, height, window.innerHeight),
    });
  };
  const end = () => {
    if (drag && live) {
      moveFloating(view.view, {
        x: live.left / window.innerWidth,
        y: live.top / window.innerHeight,
      });
      touchFloating(view.view, "moved");
    } else if (drag && !view.folded) touchFloating(view.view, "poke");
    setDrag(null);
    setLive(null);
  };
  const dragHandlers = {
    onPointerDown: start,
    onPointerMove: move,
    onPointerUp: end,
    onPointerCancel: end,
  };

  if (view.folded)
    return (
      <button
        type="button"
        className="floating-view-dot"
        style={{ left: at.left, top: at.top }}
        aria-label={t.floatingUnfold.replace("{name}", view.title)}
        title={view.title}
        {...dragHandlers}
        onClick={() => {
          if (!moved.current) moveFloating(view.view, { folded: false });
        }}
      >
        {view.title.slice(0, 1)}
      </button>
    );

  const items: ContextMenuEntry[] = [
    ...(view.allowed === "either" && desktop
      ? [
          {
            label: t.floatingToDesktop.replace("{name}", view.title),
            onSelect: () => moveFloating(view.view, { place: "desktop" }),
          },
        ]
      : []),
    {
      label: t.floatingFold.replace("{name}", view.title),
      onSelect: () => moveFloating(view.view, { folded: true }),
    },
    "separator",
    {
      label: t.floatingClose.replace("{name}", view.title),
      onSelect: () => closeFloating(view.view),
    },
  ];

  return (
    <div
      className="floating-view"
      data-floating-view={view.view}
      data-dragging={drag ? "" : undefined}
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
        onContextMenu={(e) => {
          e.preventDefault();
          setMenu({ x: e.clientX, y: e.clientY });
        }}
      />
      <Presence show={menu !== null} exitMs={120}>
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
