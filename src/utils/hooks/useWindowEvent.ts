import { useEffect } from "react";
import { useLatest } from "./useLatest";

/**
 * Subscribes a handler to a window event, once per event name; the handler
 * read is always the latest render's, never stale state.
 */
export function useWindowEvent(
  name: string,
  handler: (e: Event) => void,
): void {
  const latest = useLatest(handler);
  useEffect(() => {
    const listener = (e: Event) => latest.current(e);
    window.addEventListener(name, listener);
    return () => window.removeEventListener(name, listener);
  }, [name, latest]);
}
