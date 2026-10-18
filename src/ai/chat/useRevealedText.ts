import { useEffect, useRef, useState } from "react";
import { StreamReveal } from "../stream-reveal";
import { motionAllowed } from "../../ui/motion";

/**
 * A streamed reply as it is drawn: while `live`, `text` revealed a frame
 * at a time at a steady pace (stream-reveal.ts); otherwise `text` itself,
 * so the end of a stream - finished, stopped or failed - shows everything
 * at once. With motion reduced, whatever has arrived shows on the next
 * render, in the steps it came in.
 */
export function useRevealedText(text: string, live: boolean): string {
  const reveal = useRef<StreamReveal | null>(null);
  const [shown, setShown] = useState("");
  useEffect(() => {
    if (!live) {
      // The next stream starts from nothing, not from this one's end.
      reveal.current = null;
      setShown("");
      return;
    }
    if (!motionAllowed()) {
      setShown(text);
      return;
    }
    const current = (reveal.current ??= new StreamReveal());
    current.update(text, false, performance.now());
    let frame = requestAnimationFrame(function step(now) {
      current.tick(now);
      setShown(current.text);
      if (!current.caughtUp) frame = requestAnimationFrame(step);
    });
    return () => cancelAnimationFrame(frame);
  }, [text, live]);
  return live ? shown : text;
}
