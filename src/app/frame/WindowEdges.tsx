import { useWindowState } from "../../platform/window-state";
import { thisWindow } from "../../platform/this-window";
import { drawsWindowEdges } from "../../platform/window-chrome";
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
  const { maximized, fullscreen } = useWindowState();
  const filled = maximized || fullscreen;

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
