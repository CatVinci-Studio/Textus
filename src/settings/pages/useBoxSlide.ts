import { useLayoutEffect, useRef } from "react";
import { measure, play } from "../../engine/motion/flip";

const BOX = ".inline-chat-bar";

/**
 * Create's box going down from the middle to under the conversation once it
 * starts: where it was is noted as the message goes (`mark`), and it slides
 * from there to its new place (FLIP).
 */
export function useBoxSlide(started: boolean) {
  const ref = useRef<HTMLDivElement>(null);
  const from = useRef<ReturnType<typeof measure> | null>(null);
  useLayoutEffect(() => {
    const before = from.current;
    from.current = null;
    if (started && before)
      play(before, { duration: "--dur-slow", easing: "--ease-out" });
  }, [started]);
  const mark = () => {
    const box = ref.current?.querySelector(BOX);
    if (box) from.current = measure([box]);
  };
  return { ref, mark };
}
