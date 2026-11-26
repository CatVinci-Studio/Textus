import { fs } from "../platform/ipc";
import { scaledPx } from "../engine/tokens/chrome-scale";
import { isMacPlatform } from "../platform/os";
import type { TreeRow } from "./tree-selection";

/** How far past the window's edge the pointer goes before the rows leave
 *  it: a push past the edge to scroll, or an overshoot, stays in the tree. */
const LEAVE_MARGIN = 24;

/** How long the pointer stays past the window's edge before the rows
 *  leave it: a push at the edge to scroll that overshoots comes straight
 *  back, and stays the tree's drag. */
export const LEAVE_AFTER_MS = 300;

/** The rows the system's drag is carrying out of this window, if any. */
let goingOut: readonly TreeRow[] | null = null;

// A press in the page means no system drag is running, even one whose end
// was never heard.
if (typeof window !== "undefined")
  window.addEventListener("pointerdown", () => (goingOut = null), true);

/** The rows of this window out with the system's drag now: one coming
 *  back over the window is the tree's own, not a file manager's. The
 *  system runs one drag at a time. */
export function rowsOut(): readonly TreeRow[] | null {
  return goingOut;
}

/** The key that makes a drag of rows a copy, as each system's file
 *  manager has it. */
export const copyKey = (): "Alt" | "Control" =>
  isMacPlatform() ? "Alt" : "Control";

/** The pointer is well past the window: the page can't follow it further. */
export function outsideWindow(x: number, y: number): boolean {
  const m = scaledPx(LEAVE_MARGIN);
  return (
    x < -m || y < -m || x > window.innerWidth + m || y > window.innerHeight + m
  );
}

/** `rows` handed to the system's drag as real files (copies), for a file
 *  manager, a mail or any other app; true once something took them. */
export async function dragOut(rows: readonly TreeRow[]): Promise<boolean> {
  goingOut = rows;
  try {
    return await fs.dragOut(rows.map((row) => row.path));
  } catch {
    return false;
  } finally {
    goingOut = null;
  }
}
