import { useEffect, useRef } from "react";

/** How near the bottom still counts as at it, for a wheel's last step. */
const NEAR = 40;

/**
 * Keeps the newest streamed content in view while it grows - while the
 * reader is at the bottom. Scrolled up, the list stays where they put it:
 * it was pulled back down on every piece of a reply, and could not be
 * scrolled up, or read an opened row, until the reply ended. Back at the
 * bottom, or on the next send (`stick`), it follows again.
 */
export function useFollowBottom(content: unknown) {
  const ref = useRef<HTMLDivElement>(null);
  const following = useRef(true);
  useEffect(() => {
    const el = ref.current;
    if (!content || !el || !following.current) return;
    el.scrollTo({ top: el.scrollHeight });
  }, [content]);
  return {
    ref,
    /** The list's onScroll: where the reader left it. */
    onScroll() {
      const el = ref.current;
      if (el)
        following.current =
          el.scrollHeight - el.scrollTop - el.clientHeight < NEAR;
    },
    /** Follow again from here (a new message sent). */
    stick() {
      following.current = true;
    },
  };
}
