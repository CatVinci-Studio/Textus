import { useWindowState } from "../../platform/window-state";
import { thisWindow } from "../../platform/this-window";
import {
  drawsWindowEdges,
  drawsWindowOutline,
} from "../../platform/window-chrome";
import "./window-edges.css";
import "./window-outline.css";

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
 * Resize edges inside a Linux window, beside GTK's outer margin. Pressing
 * hands the drag to the compositor, which also works under Wayland. Dropped
 * while the window fills the screen.
 */
export function WindowEdges() {
  const { maximized, fullscreen } = useWindowState();
  const filled = maximized || fullscreen;

  if (!drawsWindowEdges || filled) return null;

  return (
    <>
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

/** The window's edge in the theme's colour where the page draws it
 *  (drawsWindowOutline); none while it fills the screen. */
export function WindowOutline() {
  const { maximized, fullscreen } = useWindowState();
  if (!drawsWindowOutline() || maximized || fullscreen) return null;
  return <div className="window-outline" aria-hidden="true" />;
}
