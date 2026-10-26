import { useEffect, useRef } from "react";

/**
 * A ref that always holds the latest value, for long-lived closures that
 * would otherwise keep the value from the render that made them.
 */
export function useLatest<T>(value: T): { readonly current: T } {
  const ref = useRef(value);
  useEffect(() => {
    ref.current = value;
  }, [value]);
  return ref;
}
