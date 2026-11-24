import { fs } from "../platform/ipc";
import { scaledPx } from "../engine/tokens/chrome-scale";

/** How far past the window's edge the pointer goes before the rows leave
 *  it: a push past the edge to scroll, or an overshoot, stays in the tree. */
const LEAVE_MARGIN = 24;

/** How long the pointer stays past the window's edge before the rows
 *  leave it: a push at the edge to scroll that overshoots comes straight
 *  back, and stays the tree's drag. */
export const LEAVE_AFTER_MS = 300;

/** Whether the system's drag is carrying rows out of this window. */
let goingOut = false;

// A press in the page means no system drag is running, even one whose end
// was never heard.
if (typeof window !== "undefined")
  window.addEventListener("pointerdown", () => (goingOut = false), true);

/** Whether rows of this window are out with the system's drag now: one
 *  coming back over the window is the tree's own, not a file manager's.
 *  The system runs one drag at a time. */
export function isDraggingOut(): boolean {
  return goingOut;
}

/** The pointer is well past the window: the page can't follow it further. */
export function outsideWindow(x: number, y: number): boolean {
  const m = scaledPx(LEAVE_MARGIN);
  return (
    x < -m || y < -m || x > window.innerWidth + m || y > window.innerHeight + m
  );
}

/** `paths` handed to the system's drag as real files (copies), for a file
 *  manager, a mail or any other app; true once something took them. */
export async function dragOut(paths: readonly string[]): Promise<boolean> {
  goingOut = true;
  try {
    return await fs.dragOut([...paths]);
  } catch {
    return false;
  } finally {
    goingOut = false;
  }
}
