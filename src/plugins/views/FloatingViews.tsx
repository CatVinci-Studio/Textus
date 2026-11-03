import { useRef, useState, useSyncExternalStore } from "react";
import { windowInfo } from "../store/plugin-records";
import { PluginWebviewPanel } from "./PluginWebview";
import {
  closeFloating,
  floatingVersion,
  moveFloating,
  openFloatingViews,
  subscribeFloating,
  type FloatingView,
} from "./floating-views";

/** Kept this far inside the window's edges, so a view can't be lost. */
const MARGIN = 8;
/** The folded dot's size. */
const DOT = 36;

/**
 * Plugins' floating views shown in this window: each a frame of its own
 * size over the editor, moved by the bar that appears over its top on
 * hover, folded to a dot or closed from it.
 */
export function FloatingViews() {
  useSyncExternalStore(subscribeFloating, floatingVersion);
  const here = openFloatingViews().filter((v) => v.place === "window");
  if (!here.length) return null;
  return (
    <div className="floating-views">
      {here.map((view) => (
        <FloatingBox key={view.view} view={view} />
      ))}
    </div>
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

function FloatingBox({ view }: { view: FloatingView }) {
  const t = windowInfo().strings();
  const [drag, setDrag] = useState<{ dx: number; dy: number } | null>(null);
  const [live, setLive] = useState<{ left: number; top: number } | null>(null);
  const moved = useRef(false);
  const width = view.folded ? DOT : view.width;
  const height = view.folded ? DOT : view.height;
  const at = live ?? position(view, width, height);

  const start = (event: React.PointerEvent) => {
    if (event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    moved.current = false;
    setDrag({ dx: event.clientX - at.left, dy: event.clientY - at.top });
  };
  const move = (event: React.PointerEvent) => {
    if (!drag) return;
    moved.current = true;
    setLive({
      left: clamp(event.clientX - drag.dx, width, window.innerWidth),
      top: clamp(event.clientY - drag.dy, height, window.innerHeight),
    });
  };
  const end = () => {
    if (drag && live)
      moveFloating(view.view, {
        x: live.left / window.innerWidth,
        y: live.top / window.innerHeight,
      });
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
      <div className="floating-view-bar">
        <div
          className="floating-view-grip"
          role="button"
          tabIndex={-1}
          aria-label={t.floatingMove.replace("{name}", view.title)}
          title={view.title}
          {...dragHandlers}
        />
        <button
          type="button"
          className="floating-view-action"
          aria-label={t.floatingFold.replace("{name}", view.title)}
          onClick={() => moveFloating(view.view, { folded: true })}
        >
          –
        </button>
        <button
          type="button"
          className="floating-view-action"
          aria-label={t.floatingClose.replace("{name}", view.title)}
          onClick={() => closeFloating(view.view)}
        >
          ×
        </button>
      </div>
    </div>
  );
}
