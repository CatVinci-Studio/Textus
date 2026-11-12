import { useCallback, useLayoutEffect, useRef } from "react";

/**
 * A ref that always holds the latest value, for long-lived closures that
 * would otherwise keep the value from the render that made them. Updated as
 * the render commits, before any effect or event of that render runs.
 */
export function useLatest<T>(value: T): { readonly current: T } {
  const ref = useRef(value);
  useLayoutEffect(() => {
    ref.current = value;
  }, [value]);
  return ref;
}

/** `fn` as one function for the component's life, calling the latest `fn`:
 *  handed down, it changes nothing below when the caller redraws. */
export function useLatestCallback<A extends unknown[], R>(
  fn: (...args: A) => R,
): (...args: A) => R {
  const latest = useLatest(fn);
  return useCallback((...args: A) => latest.current(...args), [latest]);
}
