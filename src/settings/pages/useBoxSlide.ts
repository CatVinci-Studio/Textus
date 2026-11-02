import { useLayoutEffect, useRef } from "react";
import { animate } from "../../ui/motion";

const BOX = ".inline-chat-bar";

/**
 * Create's box going down from the middle to under the conversation once it
 * starts: where it was is noted as the message goes (`mark`), and it slides
 * from there to its new place, by transform alone.
 */
export function useBoxSlide(started: boolean) {
  const ref = useRef<HTMLDivElement>(null);
  const from = useRef<number | null>(null);
  useLayoutEffect(() => {
    const top = from.current;
    from.current = null;
    const box = ref.current?.querySelector(BOX);
    if (!started || top === null || !box) return;
    const dy = top - box.getBoundingClientRect().top;
    if (Math.abs(dy) < 1) return;
    animate(
      box,
      [{ transform: `translateY(${dy}px)` }, { transform: "translateY(0)" }],
      { duration: "--dur-slow", easing: "--ease-out" },
    );
  }, [started]);
  const mark = () => {
    const box = ref.current?.querySelector(BOX);
    if (box) from.current = box.getBoundingClientRect().top;
  };
  return { ref, mark };
}
