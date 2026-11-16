import { createSubscribers } from "../../utils/store";
/** How many plugins' floating views are open: all the startup code knows of
 *  them, so the rest loads only once one opens. */
let count = 0;
const subscribers = createSubscribers();

export function floatingCount(): number {
  return count;
}

export function setFloatingCount(next: number) {
  if (next === count) return;
  count = next;
  subscribers.publish();
}

export const subscribeFloatingCount = subscribers.subscribe;
