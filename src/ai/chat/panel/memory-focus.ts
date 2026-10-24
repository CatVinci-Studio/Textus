import { useEffect, useSyncExternalStore } from "react";
import { MARK_CLASS } from "../../../ui/moves";
import { duration, scrollBehavior } from "../../../ui/motion";

/**
 * The memory a "Remembered" chip in the chat points the Memory tab at: a
 * click on the chip opens the tab there, its memory scrolled to and marked
 * for a moment - the chip could only be read cut short, and finding the
 * memory meant searching the tab for it.
 */

let focused: string | null = null;
const listeners = new Set<() => void>();

/** Points the Memory tab at memory `id` (`scope/memory/name`, or
 *  `project/library/name` for a fact) - as RememberResult names it. */
export function focusMemory(id: string) {
  focused = id;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * Within `root` (the Memory tab), scrolls to the memory pointed at and
 * marks it, once it is drawn; then it is pointed at no longer.
 */
export function useMemoryFocus(root: HTMLElement | null) {
  const id = useSyncExternalStore(subscribe, () => focused);
  useEffect(() => {
    if (!id || !root) return;
    const el = root.querySelector<HTMLElement>(
      `[data-memory-id="${CSS.escape(id)}"]`,
    );
    if (!el) return;
    focused = null;
    el.scrollIntoView({ block: "center", behavior: scrollBehavior() });
    // Marked long enough to be found after the scroll: --dur-linger.
    el.classList.add(MARK_CLASS);
    window.setTimeout(
      () => el.classList.remove(MARK_CLASS),
      duration("--dur-linger"),
    );
  });
}
