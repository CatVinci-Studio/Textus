import { createSubscribers } from "../../utils/store";
/** Whether the document on screen tracks the writer's changes, for the Track
 *  My Changes check mark. Set by the active tab's editor. */
let tracking = false;
const subscribers = createSubscribers();

export function setTrackingShown(on: boolean): void {
  if (on === tracking) return;
  tracking = on;
  subscribers.publish();
}

export function trackingShown(): boolean {
  return tracking;
}

export const subscribeTracking = subscribers.subscribe;
