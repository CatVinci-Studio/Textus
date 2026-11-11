import { onAppearance } from "../tokens/appearance";
import { chromeScale } from "../tokens/chrome-scale";
import { useSyncExternalStore } from "react";

/** `--chrome-scale` now, for sizes set from script; follows the window's
 *  width and Interface Text Size. */
export function useChromeScale(): number {
  return useSyncExternalStore(subscribe, () =>
    typeof window === "undefined" ? 1 : chromeScale(),
  );
}

function subscribe(changed: () => void): () => void {
  const stop = onAppearance(changed);
  window.addEventListener("resize", changed);
  return () => {
    stop();
    window.removeEventListener("resize", changed);
  };
}
