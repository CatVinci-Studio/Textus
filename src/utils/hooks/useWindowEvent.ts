import { useEffect } from "react";

/**
 * Subscribes a handler to a window event, re-attaching every render so the
 * handler is always the current closure, never stale state.
 */
export function useWindowEvent(
  name: string,
  handler: (e: Event) => void,
): void {
  useEffect(() => {
    window.addEventListener(name, handler);
    return () => window.removeEventListener(name, handler);
  });
}
