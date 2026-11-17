import { useEffect } from "react";
import { useLatest } from "./useLatest";

/** `handler` told by `subscribe` while mounted, always the latest render's,
 *  never stale state: useWindowEvent for a module's own subscribers. */
export function useHeard<A extends unknown[]>(
  subscribe: (listener: (...args: A) => void) => () => void,
  handler: (...args: A) => void,
): void {
  const latest = useLatest(handler);
  useEffect(
    () => subscribe((...args) => latest.current(...args)),
    [subscribe, latest],
  );
}
