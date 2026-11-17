import { createSubscribers } from "../utils/store";
import { thisWindow } from "./this-window";

/**
 * A Mac trackpad's finger, put down for a scroll and lifted, as the native
 * side tells it (trackpad.rs): what wheel events never say. Heard while
 * something listens; null until the native side has said anything.
 */
let down: boolean | null = null;

const { subscribe, publish } = createSubscribers<[boolean]>(() => {
  const off = thisWindow()
    .listen<boolean>("trackpad-touch", (event) => {
      down = event.payload;
      publish(down);
    })
    .catch(() => () => {});
  return () => void off.then((stop) => stop());
});

export const onTrackpadTouch = subscribe;

/** Whether the finger is on the trackpad; null when this isn't known. */
export function fingerDown(): boolean | null {
  return down;
}
