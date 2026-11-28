import { useSyncExternalStore } from "react";
import { createSubscribers } from "../../utils/store";
import { arrange, type SplitLayout } from "./ops";
import type { Path } from "./tree";

/**
 * A divider's share while the pointer holds it (SplitDivider): the islands
 * are laid out at it as it moves, and the window's model takes it once,
 * when the divider is let go. Kept apart from the model so a move redraws
 * the islands' area only - not the whole window, nor its saved session,
 * nor what else reads the layout - and at most once a frame however fast
 * the pointer reports.
 */
export interface HeldShare {
  path: Path;
  index: number;
  share: number;
}

let held: HeldShare | null = null;
let frame = 0;
const subscribers = createSubscribers();

/** The divider held at `next`; null, let go (drawn from the model again
 *  at once, in the same render as the model's change). */
export function holdShare(next: HeldShare | null): void {
  held = next;
  if (next === null) {
    cancelAnimationFrame(frame);
    frame = 0;
    subscribers.publish();
    return;
  }
  frame ||= requestAnimationFrame(() => {
    frame = 0;
    subscribers.publish();
  });
}

export function heldShare(): HeldShare | null {
  return held;
}

/** The held share, kept current: the islands' area redraws with it. */
export function useHeldShare(): HeldShare | null {
  return useSyncExternalStore(subscribers.subscribe, heldShare);
}

/** `layout` as drawn while a divider is held at `share`. */
export function withHeld(
  layout: SplitLayout,
  share: HeldShare | null,
): SplitLayout {
  return (share && arrange(layout, share.path, share)) || layout;
}
