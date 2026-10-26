import { useEffect, useState } from "react";
import { thisWindow } from "../platform/this-window";
import { drawsWindowEdges } from "../platform/window-chrome";
import "./window-edges.css";

type ResizeDirection =
  | "North"
  | "South"
  | "East"
  | "West"
  | "NorthEast"
  | "NorthWest"
  | "SouthEast"
  | "SouthWest";

const EDGES: ResizeDirection[] = [
  "North",
  "South",
  "East",
  "West",
  "NorthEast",
  "NorthWest",
  "SouthEast",
  "SouthWest",
];

/**
 * The outline and resize edges an undecorated Linux window lacks. Pressing
 * hands the drag to the compositor, which also works under Wayland. Dropped
 * while the window fills the screen.
 */
export function WindowEdges() {
  const [filled, setFilled] = useState(false);

  useEffect(() => {
    if (!drawsWindowEdges) return;
    const win = thisWindow();
    let alive = true;
    const sync = () => {
      void Promise.all([win.isMaximized(), win.isFullscreen()])
        .then(([maximized, fullscreen]) => {
          if (alive) setFilled(maximized || fullscreen);
        })
        .catch(() => {
          // No backend (dev shim) - keep the edges.
        });
    };
    sync();
    // A drag-resize fires this every frame, and each sync is three IPC
    // round trips; only where the resize ends matters.
    let settle: ReturnType<typeof setTimeout> | undefined;
    const unlisten = win.onResized(() => {
      clearTimeout(settle);
      settle = setTimeout(sync, 100);
    });
    return () => {
      alive = false;
      clearTimeout(settle);
      void unlisten.then((off) => off());
    };
  }, []);

  if (!drawsWindowEdges || filled) return null;

  return (
    <>
      <div className="window-edge-outline" aria-hidden="true" />
      {EDGES.map((edge) => (
        <div
          key={edge}
          className="window-edge"
          data-edge={edge}
          aria-hidden="true"
          onPointerDown={(e) => {
            if (e.button !== 0) return;
            e.preventDefault();
            void thisWindow().startResizeDragging(edge);
          }}
        />
      ))}
    </>
  );
}
