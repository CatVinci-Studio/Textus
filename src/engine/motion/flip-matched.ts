import { motionAllowed } from "./motion";
import { play } from "./flip";

/**
 * FLIP for a change that builds its elements again (a list written anew in
 * another order): each new element slides from where the old one with the
 * same `key` stood. Like keys are matched in order; one with no match just
 * appears.
 */
export function flipMatched(
  elements: () => Iterable<Element>,
  key: (el: Element) => string,
  mutate: () => void,
): void {
  if (!motionAllowed()) {
    mutate();
    return;
  }
  const was = new Map<string, DOMRect[]>();
  for (const el of elements()) {
    const k = key(el);
    const rects = was.get(k);
    if (rects) rects.push(el.getBoundingClientRect());
    else was.set(k, [el.getBoundingClientRect()]);
  }
  mutate();
  const before = new Map<Element, DOMRect>();
  for (const el of elements()) {
    const rect = was.get(key(el))?.shift();
    if (rect) before.set(el, rect);
  }
  play(before);
}
